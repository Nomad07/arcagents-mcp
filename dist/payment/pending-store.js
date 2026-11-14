/**
 * Durable store for signed-but-unresolved purchases, one file per request.
 *
 * uvd-x402-sdk documents that a purchase context (signed authorization plus its
 * secret capability) must be persisted durably before the authorized request is
 * sent, and resumed after a lost response, restart or HTTP 500, with no new
 * signature on resume (docs/facilitator-receipts.md).
 *
 * Layout: <stateDir>/<sha256(canonical request URL)>.json, one record per request.
 * A request's update or deletion therefore never touches another request's state.
 *
 * claim() creates the record with an exclusive create (flag "wx", atomic on Unix
 * and Windows). Whoever creates it owns the right to send a payment for that
 * request; everyone else gets PendingClaimExistsError and must not send.
 *
 * Confidentiality: files are created 0600 and directories THIS code creates are
 * restricted to 0700 on Unix. Existing directories are never modified. Windows
 * ignores these modes: protection there comes from the ACL the directory inherits,
 * so the default location is under the user profile and a custom
 * ARCAGENTS_STATE_DIR must carry a restrictive ACL (see README).
 *
 * Nothing here is a database and nothing leaves the machine.
 */
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeSync, } from "node:fs";
import { dirname, join } from "node:path";
/** Another process already owns an unresolved payment for this request. */
export class PendingClaimExistsError extends Error {
    constructor() {
        super("an unresolved payment for this request already exists");
        this.name = "PendingClaimExistsError";
    }
}
/** A record for this request is being written by another process right now. */
export class PendingClaimInProgressError extends Error {
    constructor() {
        super("another process is saving a payment for this request");
        this.name = "PendingClaimInProgressError";
    }
}
const RECORD_RE = /^[0-9a-f]{64}\.json$/;
const TMP_RE = /^[0-9a-f]{64}\.json\.\d+\.[0-9a-f]{16}\.tmp$/;
/** A live write finishes in milliseconds; anything this old was abandoned by a crashed process. */
const ORPHAN_TMP_AGE_MS = 10 * 60 * 1000;
const ORPHAN_EMPTY_AGE_MS = 60 * 1000;
export class PendingPaymentStore {
    dir;
    constructor(dir) {
        this.dir = dir;
        this.cleanupOrphans();
    }
    /** Returns the saved purchase for this request, or undefined. Throws if the state cannot be read. */
    get(url) {
        const { canonical, path } = this.locate(url);
        let raw;
        try {
            raw = readFileSync(path, "utf8");
        }
        catch (error) {
            if (error.code === "ENOENT")
                return undefined;
            throw error;
        }
        // An exclusive create is visible before its content is written.
        if (raw.length === 0)
            throw new PendingClaimInProgressError();
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || parsed.url !== canonical || !parsed.context || typeof parsed.context !== "object") {
            throw new Error("unexpected record contents");
        }
        return parsed.context;
    }
    has(url) {
        return this.get(url) !== undefined;
    }
    /**
     * Atomically claims the request and saves the signed purchase durably. Throws
     * PendingClaimExistsError if a record already exists: the caller must not send.
     */
    claim(url, context) {
        const { canonical, path } = this.locate(url);
        this.ensureDir();
        let fd;
        try {
            fd = openSync(path, "wx", 0o600);
        }
        catch (error) {
            if (error.code === "EEXIST")
                throw new PendingClaimExistsError();
            throw error;
        }
        try {
            writeSync(fd, JSON.stringify({ url: canonical, context }));
            fsyncSync(fd);
        }
        catch (error) {
            closeSync(fd);
            this.tryUnlink(path); // never leave an empty claim behind
            throw error;
        }
        closeSync(fd);
    }
    /** Replaces this request's own record (atomic write-then-rename). Other requests are untouched. */
    update(url, context) {
        const { canonical, path } = this.locate(url);
        this.ensureDir();
        const tmp = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
        const fd = openSync(tmp, "wx", 0o600);
        try {
            writeSync(fd, JSON.stringify({ url: canonical, context }));
            fsyncSync(fd);
        }
        catch (error) {
            closeSync(fd);
            this.tryUnlink(tmp);
            throw error;
        }
        closeSync(fd);
        try {
            renameSync(tmp, path);
        }
        catch (error) {
            this.tryUnlink(tmp);
            throw error;
        }
    }
    /** Removes this request's record only. */
    delete(url) {
        const { path } = this.locate(url);
        try {
            unlinkSync(path);
        }
        catch (error) {
            if (error.code !== "ENOENT")
                throw error;
        }
    }
    locate(url) {
        const canonical = new URL(url).href;
        const name = createHash("sha256").update(canonical).digest("hex");
        return { canonical, path: join(this.dir, `${name}.json`) };
    }
    /**
     * Creates the state directory. Only directories created here are restricted (0700, Unix);
     * a directory that already exists is never touched.
     */
    ensureDir() {
        const firstCreated = mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        if (!firstCreated || process.platform === "win32")
            return;
        let current = this.dir;
        for (;;) {
            try {
                chmodSync(current, 0o700);
            }
            catch {
                // Best effort: mkdir already applied 0700 (minus umask).
            }
            if (current === firstCreated)
                break;
            const parent = dirname(current);
            if (parent === current)
                break;
            current = parent;
        }
    }
    /**
     * Best-effort removal of this implementation's own abandoned files: temp files and empty
     * claims older than a few minutes. Only exact generated names directly inside the state
     * directory are considered, never anything else, and never a record that has content.
     */
    cleanupOrphans() {
        let names;
        try {
            names = readdirSync(this.dir);
        }
        catch {
            return;
        }
        const now = Date.now();
        for (const name of names) {
            const isTmp = TMP_RE.test(name);
            if (!isTmp && !RECORD_RE.test(name))
                continue;
            const path = join(this.dir, name);
            try {
                const stat = lstatSync(path);
                if (!stat.isFile())
                    continue;
                const age = now - stat.mtimeMs;
                if (isTmp ? age > ORPHAN_TMP_AGE_MS : stat.size === 0 && age > ORPHAN_EMPTY_AGE_MS)
                    unlinkSync(path);
            }
            catch {
                // Another process may have removed it already.
            }
        }
    }
    tryUnlink(path) {
        try {
            unlinkSync(path);
        }
        catch {
            // Nothing more to do.
        }
    }
}
