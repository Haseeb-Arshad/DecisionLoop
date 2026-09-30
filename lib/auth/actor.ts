import type { Actor } from "@decisionloop/core/types/records";
import type { AuthContext } from "./currentUser";

export function userActor(auth: AuthContext): Actor {
  return {
    tenantId: auth.tenantId,
    type: "user",
    userId: auth.user.id,
    label: auth.user.name,
    scopes: ["admin"],
    sessionId: `sess_${auth.sessionId.slice(0, 12)}`,
  };
}
