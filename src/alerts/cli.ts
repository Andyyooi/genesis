import { refreshAlertsForUniverse } from "@/alerts/refresh";

function main() {
  const summary = refreshAlertsForUniverse();
  console.log(JSON.stringify({ kind: "alerts", summary }, null, 2));
}

main();
