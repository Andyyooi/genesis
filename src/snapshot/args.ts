export type SnapshotCommandArgs = {
  source?: string;
  dest?: string;
  artifact?: string;
  current?: string;
  dryRun: boolean;
  writeProduction: boolean;
};

export function parseSnapshotArgs(argv: string[]): SnapshotCommandArgs {
  const args: SnapshotCommandArgs = { dryRun: false, writeProduction: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--write-production") {
      args.writeProduction = true;
      continue;
    }
    const value = argv[index + 1];
    if (!token || !value || value.startsWith("--")) {
      throw new Error(`Missing value for ${token ?? "argument"}`);
    }
    if (token === "--source") args.source = value;
    else if (token === "--dest") args.dest = value;
    else if (token === "--artifact") args.artifact = value;
    else if (token === "--current") args.current = value;
    else throw new Error(`Unknown argument ${token}`);
    index += 1;
  }
  return args;
}
