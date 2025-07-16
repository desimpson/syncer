import { describe, it, expect } from "vitest";
import { generateCodeVerifier, generateS256CodeChallenge } from "@/utils/crypto";

describe("PKCE utilities", () => {
  describe("generateCodeVerifier", () => {
    it("returns a string", () => {
      // Arrange & Act
      const verifier = generateCodeVerifier();

      // Assert
      expect(typeof verifier).toBe("string");
    });

    it("returns a string of reasonable length", () => {
      // Arrange & Act
      const verifier = generateCodeVerifier();

      // Assert
      // Base64url of 32 bytes → ~43 characters (32 * 4 / 3 = 42.66, rounded up)
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(44);
    });

    it("returns different values on consecutive calls", () => {
      // Arrange & Act
      const verifier1 = generateCodeVerifier();
      const verifier2 = generateCodeVerifier();

      // Assert
      expect(verifier1).not.toEqual(verifier2);
    });
  });

  describe("generateS256CodeChallenge", () => {
    const testCases: { verifier: string }[] = [
      { verifier: "simple-verifier" },
      { verifier: "another-verifier-1234567890" },
      { verifier: "short" },
    ];

    testCases.forEach(({ verifier }) => {
      it(`produces a base64url string for verifier: ${verifier}`, async () => {
        // Act
        const challenge = await generateS256CodeChallenge(verifier);

        // Assert
        expect(typeof challenge).toBe("string");
        expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/); // base64url regex
        expect(challenge.length).toBeGreaterThan(0);
      });
    });

    it("produces different challenges for different verifiers", async () => {
      // Arrange
      const v1 = "verifier-one";
      const v2 = "verifier-two";

      // Act
      const challenge1 = await generateS256CodeChallenge(v1);
      const challenge2 = await generateS256CodeChallenge(v2);

      // Assert
      expect(challenge1).not.toEqual(challenge2);
    });

    it("produces deterministic challenge for same verifier", async () => {
      // Arrange
      const verifier = "deterministic-verifier";

      // Act
      const challenge1 = await generateS256CodeChallenge(verifier);
      const challenge2 = await generateS256CodeChallenge(verifier);

      // Assert
      expect(challenge1).toEqual(challenge2);
    });
  });
});
