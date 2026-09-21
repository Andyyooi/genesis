import { assignResearchProfiles } from "./assign-profiles";

const result = assignResearchProfiles();
console.log(JSON.stringify({ kind: "research-profiles", ...result }, null, 2));
