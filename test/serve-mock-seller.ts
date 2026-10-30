/**
 * Run the mock seller from the tests as a standalone server, for trying the CLI or the GitHub Action by hand and for
 * the action's own CI job:
 *
 *   npm run mock-seller -- [good|flawed] [port]     (defaults: good, 4020)
 *
 * It serves until it is stopped (Ctrl+C or SIGTERM). Never accepts a payment.
 */
import { startMockSeller, type Variant } from './mock-seller.js';

const [variantArg = 'good', portArg = '4020'] = process.argv.slice(2);
if (variantArg !== 'good' && variantArg !== 'flawed') {
  process.stderr.write(`mock seller: variant must be good or flawed, got "${variantArg}"\n`);
  process.exit(2);
}
const port = Number(portArg);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write(`mock seller: bad port "${portArg}"\n`);
  process.exit(2);
}

const seller = await startMockSeller(variantArg as Variant, port);
process.stdout.write(`mock seller (${variantArg}) listening on ${seller.origin}\n`);
const stop = () => {
  seller.close().then(
    () => process.exit(0),
    () => process.exit(1)
  );
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
