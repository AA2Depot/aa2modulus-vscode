import * as path from 'node:path';
import Mocha from 'mocha';

/** Runs the one suite file that the runner names in AA2M_TEST_SUITE. */
export async function run(): Promise<void> {
  const suite = process.env.AA2M_TEST_SUITE;
  if (!suite) {
    throw new Error('AA2M_TEST_SUITE names no suite; run the e2e tests through runTest.js.');
  }
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 30000 });
  mocha.addFile(path.join(__dirname, suite));
  await new Promise<void>((resolve, reject) => {
    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(failures + ' integration tests failed.'));
      } else {
        resolve();
      }
    });
  });
}
