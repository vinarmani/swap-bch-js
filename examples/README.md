# SWaP Protocol Reference

## End-To-End Examples

This directory contains ene-to-end examples for Exchange (Type 1), Escrow (Type 2), and Threshold Crowdfunding (Type 3) collaborative transactions as described in the [Signal, Watch, and Pay (SWaP) Protocol Specification](https://github.com/vinarmani/swap-protocol/blob/master/swap-protocol-spec.md).

To install the necessary dependencies required to run the files, simply execute the following commands:

#### For node.js
1. Clone the repository locally<br>
`git clone https://github.com/vinarmani/swap-bch-js.git`

2. Enter the newly created directory and run<br>
`cd swap-bch-js`
`npm install`

3. Navigate to the examples directory<br>
`cd examples`

4. Run one of the example scripts, noting any instructions delivered in error messages<br>
`node e2e_exchange.js` for exchange<br>
`node e2e_escrow.js` for escrow<br>
`node e2e_cf.js` for threshold crowdfund<br>

Note: These scripts all run on the mainnet of BCH.

The first time you run one of the scripts after install, a new set of wallets will be created for you automatically. WIF data for these wallets will be located in a newly created file names `e2e.json`. You will be given an address to fund and told the amount you need to send to the wallet. This amount is equivalent (at the time of this writing), to less than 30 cents US.

Upon running the script again, funds will be automatically distributed to each of the wallet addresses in amounts sufficient to complete the end to end tests. Any additional funds in these addresses are recollected when any end-to-end example script is run again and thus can be reused many times to run the tests.
