import { InputError } from "./context";

/** The person (or agent acting for a person) making a request. */
export type User = { key: string; role: "parent" | "child"; /** set when an agent token is used */ agent?: string };

export class Forbidden extends InputError {}

/**
 * Parents can do everything. Children can log and change activities they took part in,
 * log and change their own spending, and view the family day and savings goals.
 */
export const can = {
  writeActivity(user: User, members: string[], existingMembers?: string[]) {
    if (user.role === "parent") return;
    if (!members.includes(user.key)) throw new Forbidden("You can only log activities you took part in");
    if (existingMembers && !existingMembers.includes(user.key)) throw new Forbidden("That activity is not yours to change");
  },
  writeTransaction(user: User, member: string | null | undefined, existingMember?: string | null) {
    if (user.role === "parent") return;
    if (member !== user.key) throw new Forbidden("You can only log your own spending");
    if (existingMember !== undefined && existingMember !== user.key) throw new Forbidden("That entry is not yours to change");
  },
  seeTransaction(user: User, member: string | null) {
    return user.role === "parent" || member === user.key;
  },
  parentOnly(user: User, what: string) {
    if (user.role !== "parent") throw new Forbidden(`Only parents can ${what}`);
  },
};
