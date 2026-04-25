import { claimNextExecutingLaunch, getContributions, releaseLaunchLock } from "./db";
import { executeBagsLaunch } from "./executeBags";
import { executePumpfunLightningLaunch } from "./executePumpfunLightning";

export async function executeAllPendingLaunches(workerId: string): Promise<void> {
  try {
    // Atomically claim launches one at a time. SKIP LOCKED guarantees no two
    // executor replicas ever pick up the same launch. Loop until this worker
    // can't claim more, kicking each off in the background.
    while (true) {
      const launch = await claimNextExecutingLaunch(workerId);
      if (!launch) break;

      console.log(`Worker ${workerId} claimed launch ${launch.id} for execution`);

      const run = async () => {
        try {
          const contributions = await getContributions(launch.id);
          if (contributions.length === 0) {
            console.log(`No contributions for launch ${launch.id}, skipping`);
            return;
          }

          if (launch.platform === "pumpfun") {
            await executePumpfunLightningLaunch(launch, contributions);
          } else {
            await executeBagsLaunch(launch, contributions);
          }
        } catch (err: any) {
          console.error(
            `Unhandled error executing launch ${launch.id}:`,
            err.message
          );
        } finally {
          await releaseLaunchLock(launch.id);
        }
      };

      run();
    }
  } catch (err: any) {
    console.error("Error in executeAllPendingLaunches:", err.message);
  }
}