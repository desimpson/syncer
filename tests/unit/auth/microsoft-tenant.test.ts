import { describe, it, expect } from "vitest";
import { microsoftGraphTenantSegmentFromAuthSelection } from "@/auth/microsoft";

describe("microsoftGraphTenantSegmentFromAuthSelection", () => {
  it("returns consumers for personal accounts", () => {
    // Act & Assert
    expect(
      microsoftGraphTenantSegmentFromAuthSelection({
        accountKind: "personal",
        workOrSchoolTenantId: "",
      }),
    ).toBe("consumers");

    expect(
      microsoftGraphTenantSegmentFromAuthSelection({
        accountKind: "personal",
        workOrSchoolTenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
    ).toBe("consumers");
  });

  it("returns organizations for work or school when tenant id is empty", () => {
    // Act & Assert
    expect(
      microsoftGraphTenantSegmentFromAuthSelection({
        accountKind: "workSchool",
        workOrSchoolTenantId: "",
      }),
    ).toBe("organizations");

    expect(
      microsoftGraphTenantSegmentFromAuthSelection({
        accountKind: "workSchool",
        workOrSchoolTenantId: "   ",
      }),
    ).toBe("organizations");
  });

  it("returns the tenant GUID for work or school when provided", () => {
    // Arrange
    const tenant = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    // Act & Assert
    expect(
      microsoftGraphTenantSegmentFromAuthSelection({
        accountKind: "workSchool",
        workOrSchoolTenantId: tenant,
      }),
    ).toBe(tenant);
  });
});
