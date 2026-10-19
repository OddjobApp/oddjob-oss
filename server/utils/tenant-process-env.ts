/**
 * The environment for a child process that runs tenant-authored code: a
 * generated app, its `npm install` (postinstall scripts), its build, its type
 * check, `mvn compile` plugins.
 *
 * Node's child_process inherits the whole server environment by default, and
 * the forge spread `...process.env` on purpose — so a generated app, or any
 * package its manifest pulled in, could read ENCRYPTION_KEY (every org's stored
 * secrets), SESSION_SECRET and DATABASE_URL. Tenant code gets an allowlist:
 * what an OS and a toolchain need to run, nothing the platform holds.
 *
 * An allowlist, not a denylist: a new platform secret added to the
 * environment tomorrow must not leak by default.
 */
const PASSTHROUGH = new Set([
    // Locating binaries and the user profile
    "PATH", "PATHEXT", "HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH",
    "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
    "COMMONPROGRAMFILES", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "OS",
    "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE", "SHELL", "USER", "USERNAME", "LOGNAME",
    // Scratch space, locale, terminal
    "TEMP", "TMP", "TMPDIR", "LANG", "LANGUAGE", "LC_ALL", "LC_CTYPE", "TZ", "TERM",
    // Network egress the host is configured for
    "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "NODE_EXTRA_CA_CERTS",
    // Toolchain locations and caches (never credentials)
    "NPM_CONFIG_CACHE", "NPM_CONFIG_REGISTRY", "NPM_CONFIG_PREFIX", "NVM_HOME", "NVM_SYMLINK",
    "GOPATH", "GOROOT", "GOCACHE", "GOMODCACHE", "JAVA_HOME", "MAVEN_HOME", "M2_HOME",
    "PYTHONHOME", "VIRTUAL_ENV", "PYTHONIOENCODING",
]);

export function tenantProcessEnv(
    extra: Record<string, string | undefined> = {},
    source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(source)) {
        // Windows variable names are case-insensitive (Path, SystemRoot, ...).
        if (value !== undefined && PASSTHROUGH.has(name.toUpperCase())) env[name] = value;
    }
    for (const [name, value] of Object.entries(extra)) {
        if (value !== undefined) env[name] = value;
    }
    return env;
}
