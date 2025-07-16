import { randomBytes } from "node:crypto";

/**
 * Generates a cryptographically random code verifier string for PKCE.
 *
 * @returns A base64url-encoded random string to use as the code verifier
 */
export const generateCodeVerifier = () => randomBytes(32).toString("base64url");

const sha256 = async (plain: string): Promise<ArrayBuffer> => {
  const encoder = new TextEncoder();
  return crypto.subtle.digest("SHA-256", encoder.encode(plain));
};

const base64urlEncode = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  const binary = String.fromCodePoint(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

/**
 * Generates a base64url-encoded SHA-256 code challenge from a code verifier.
 *
 * @param codeVerifier - The code verifier string to hash and encode
 * @returns A Promise resolving to the base64url-encoded SHA-256 hash string
 */
export const generateS256CodeChallenge = async (codeVerifier: string): Promise<string> => {
  const hashed = await sha256(codeVerifier);
  return base64urlEncode(hashed);
};
