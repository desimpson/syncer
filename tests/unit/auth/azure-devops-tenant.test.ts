import { describe, it, expect } from "vitest";
import { azureDevOpsTenantSegmentFromAuthSelection } from "@/auth/azure-devops";

describe("azureDevOpsTenantSegmentFromAuthSelection", () => {
  it("returns common for personal accounts", () => {
    // Act & Assert
    expect(
      azureDevOpsTenantSegmentFromAuthSelection({
        accountKind: "personal",
        workOrSchoolTenantId: "",
      }),
    ).toBe("common");

    expect(
      azureDevOpsTenantSegmentFromAuthSelection({
        accountKind: "personal",
        workOrSchoolTenantId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      }),
    ).toBe("common");
  });

  it("returns organizations for work or school when tenant id is empty", () => {
    // Act & Assert
    expect(
      azureDevOpsTenantSegmentFromAuthSelection({
        accountKind: "workSchool",
        workOrSchoolTenantId: "",
      }),
    ).toBe("organizations");

    expect(
      azureDevOpsTenantSegmentFromAuthSelection({
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
      azureDevOpsTenantSegmentFromAuthSelection({
        accountKind: "workSchool",
        workOrSchoolTenantId: tenant,
      }),
    ).toBe(tenant);
  });
});
