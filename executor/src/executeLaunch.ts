import {
  claimNextExecutingLaunch,
  claimNextSweepRecovery,
  getContributions,
  releaseLaunchLock,
} from "./db";
import { executeBagsLaunch } from "./executeBags";
import { executePumpfunLightningLaunch } from "./executePumpfunLightning";
import { recoverPumpfunSweep } from "./recoverPumpfunSweep";

export async function executeAllPendingLaunches(workerId: string): Promise<void> {
  try {
    // First, drain any sweep_recovery launches. These are launches whose
    // mint already exists on-chain but whose custodial -> escrow token
    // sweep failed previously. They run before fresh launches because
    // contributor tokens are still stuck.
    while (true) {
      const launch = await claimNextSweepRecovery(workerId);
      if (!launch) break;
      console.log(`Worker ${workerId} claimed launch ${launch.id} for sweep recovery`);
      const run = async () => {
        try {
          await recoverPumpfunSweep(launch);
        } catch (err: any) {
          console.error(
            `Unhandled error recovering sweep for launch ${launch.id}:`,
            err.message
          );
        } finally {
          await releaseLaunchLock(launch.id);
        }
      };
      run();
    }

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