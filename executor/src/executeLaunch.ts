import { getExecutingLaunches, getContributions } from "./db";
import { executeBagsLaunch } from "./executeBags";
import { executePumpfunLaunch } from "./executePumpfun";

const processing = new Set<string>();

export async function executeAllPendingLaunches(): Promise<void> {
  try {
    const launches = await getExecutingLaunches();
    if (launches.length === 0) return;

    console.log(`Found ${launches.length} launches to execute`);

    for (const launch of launches) {
      if (processing.has(launch.id)) {
        console.log(`Launch ${launch.id} already being executed, skipping`);
        continue;
      }

      processing.add(launch.id);

      const run = async () => {
        try {
          const contributions = await getContributions(launch.id);
          if (contributions.length === 0) {
            console.log(`No contributions for launch ${launch.id}, skipping`);
            return;
          }

          if (launch.platform === "pumpfun") {
            await executePumpfunLaunch(launch, contributions);
          } else {
            await executeBagsLaunch(launch, contributions);
          }
        } catch (err: any) {
          console.error(
            `Unhandled error executing launch ${launch.id}:`,
            err.message
          );
        } finally {
          processing.delete(launch.id);
        }
      };

      run();
    }
  } catch (err: any) {
    console.error("Error in executeAllPendingLaunches:", err.message);
  }
}