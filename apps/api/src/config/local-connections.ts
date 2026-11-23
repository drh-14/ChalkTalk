import { isIP } from "node:net";
/** Intentionally restricted URL grammar shared with the shell's acceptance fixtures. */
export function validateLocalConnection(
  field: "DATABASE_URL" | "S3_ENDPOINT",
  value: string,
): void {
  const invalid = () => {
    throw new Error(
      `${field} must use the supported local connection URL grammar`,
    );
  };
  if (
    /[^!-~]|["'\\$`#]/.test(value) ||
    /%(?![0-9a-f]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f|[89a-f][0-9a-f])/i.test(value)
  )
    invalid();
  const match =
    /^(postgresql|postgres|https|http):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?$/.exec(
      value,
    );
  if (!match) return invalid();
  const [, scheme, authority, path, query] = match;
  const database = field === "DATABASE_URL";
  if (
    database
      ? !["postgresql", "postgres"].includes(scheme)
      : !["http", "https"].includes(scheme)
  )
    invalid();
  let hostPort = authority;
  if (database) {
    const credentials = /^[^:@]+:[^:@]+@(.+)$/.exec(authority);
    if (!credentials || !/^\/[^/]+$/.test(path)) return invalid();
    hostPort = credentials[1];
    if (
      query !== undefined &&
      !/^sslmode=(disable|require|verify-ca|verify-full)$/.test(query)
    )
      invalid();
  } else if (authority.includes("@") || query !== undefined) invalid();
  const hostMatch =
    /^(\[[0-9a-f:]+\]|[A-Za-z0-9.-]+)(?::([1-9][0-9]*))?$/i.exec(hostPort);
  if (!hostMatch) return invalid();
  const [, host, port] = hostMatch;
  if (port && (port.length > 5 || Number(port) > 65535)) invalid();
  if (host.startsWith("[")) {
    if (isIP(host.slice(1, -1)) !== 6) invalid();
  } else if (/^[0-9.]+$/.test(host)) {
    if (isIP(host) !== 4) invalid();
  } else if (
    host.length > 253 ||
    !host
      .split(".")
      .every(
        (label) =>
          label.length <= 63 &&
          /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
      )
  )
    invalid();
}

export function validateLocalLiteral(field: string, value: string): void {
  if (/[^ -~]|^[ \t]|[ \t]$|["'\\$`]/.test(value))
    throw new Error(`${field} must use restricted literal syntax`);
}
