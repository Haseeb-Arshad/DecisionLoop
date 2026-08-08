import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/repo/tenants";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Acme Platform Team")).toBe("acme-platform-team");
  });

  it("strips non-alphanumeric characters", () => {
    expect(slugify("Foo & Bar, Inc.!")).toBe("foo-bar-inc");
  });

  it("trims leading/trailing hyphens", () => {
    expect(slugify("--Acme--")).toBe("acme");
  });

  it("falls back to 'workspace' when nothing alphanumeric is left", () => {
    expect(slugify("   !!!   ")).toBe("workspace");
  });
});
