import { method, Field, SmartContract, state, State ,Signature, PublicKey } from "o1js";

/**
 * GetTime
 * This smart contract ONLY puprpose is to interact with an oracle
 * that provides the time in milliseconds as stated in :
 * https://developer.mozilla.org/fr/docs/Web/JavaScript/Reference/Global_Objects/Date/now
 * An oracle is needed for the different parties to have a
 * standards representation of time and avoid cheating as users
 * could throw in any time as it remains a secret.
 * 
 * Note : ClockVerifier was suppoesed to inherit the GetTime contract's
 * logic bu did not because of an internal bug. This contract is still
 * useful on it's own to verify the logic functionality and discriminate
 * oracle tests, thus making it easier to sport a fault on the oracle side.
 */

export const ORACLE_PUBLIC_KEY =
  'B62qjrPXot2doFFCpT228TKe6hsfGEUnRmDFoWKFo1ANCHaxtizaWKp';

// https://punchoracle.netlify.app/.netlify/functions/api

export class GetTime extends SmartContract{
    @state(PublicKey) oraclePublicKey = State<PublicKey>();

    init() {
        // Initialize zkApp state
        super.init();
        this.oraclePublicKey.set(PublicKey.fromBase58(ORACLE_PUBLIC_KEY));
        this.requireSignature();
    }
    
    @method async verifyOracle(
        newTimeFromOracle : Field,
        oracleSignature: Signature, // Orcale signature
    ) {
        // Verify the oracle data is authentic
        const oraclePublicKey = this.oraclePublicKey.getAndRequireEquals();
        const validSignature = oracleSignature.verify(oraclePublicKey, [newTimeFromOracle])
        validSignature.assertTrue();
    }
}
