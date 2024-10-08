# Punchy : protocol's contracts

Punchy is a punch clock solution based on the Mina blockchain and o1js framework by empowering MerkleTrees.

Punch clocks can be the source of problems when it come to everyday office life, from the worker
fear of being tracked to the employer fear of employees cheating by using tricks,
we can sometimes diverge from the initial idea of a simple legal proof of the worked
hours to emit a paycheck.

Punchy aims at implementing the punch clock system unsing the Mina blockchain as a trust party.

## Server off-chain storage 

A first solution implies a public storage server that **has to be in sync with the chain**, meaning he has to
approve (via signature) the transactions made to the chaian and relay the private data, thus implying a degree
of trust that **equals the trust given to the oracle**.

Pros :
- Public data always availible
- No need for proving transactions

Cons :
- Degree of trust needed in the server (Orcale level)

### Overview of a transaction's lifetime

![Protocole image](https://image.noelshack.com/fichiers/2024/40/6/1728111893-capture-d-cran-du-2024-10-05-09-04-03.png)

The server first recieves private data from the worker :
- The last time the worker was seen, something only the worker knows
- The fetched time when punching the clock, authenticated with oracle signature
- The current public state of his profile as decribed by this code snippet :

```typescript
// Worker's data stored on the server as public data
export class WorkerServerPublicData extends Struct({
    workerPublicKey : PublicKey,
    workedHours : Field
}){
    //...
}
```

The user provides additionals private information for the contract, completing the Wrker struct as
stated in the contract.

```typescript
// Worker's data stored on the server as public data
export class Worker extends Struct({
    workerPublicKey : PublicKey,
    workedHours : Field,
    // Below fields are provided as private inputs
    currentlyWorking : Field, // private
    lastSeen : Field // private
}){
    //...
}
```

This class is stored on the server's database in plain and the merkle tree contains hashed versions
of the worker class as a proof of autheticity, see the below exmaple of an updated tot he merkle tree
for exmaple : 

```typescript
const newRoot = witness.calculateRoot(Poseidon.hash(Worker.toFields(newWorker)));
```

This way, the server's merkle tree is public and can serve as a way to authenticate the data
when necessary, but never disclose the private data inputs that were used. On the other hand, it is
the worker's responsabilty to keep track of all it's private informations in order to generate new TX.

### Initial state

When it comes to hiring new workers, we have to make sure they have a dedicated placein the truthy tree
held by the server and the chain, as a Merkle tree's leafs are by default initialized to a ```Field(0)``` value.

The ```ClockVerifier``` embedded a method that creates a new Worker with default initial public a private states :

- ```workerPublicKey``` gets set to the given public key when calling the method
- ```workedHours``` gets set to ```Field(0)``` by default, note that this means 0 ms, as "hours" is used for convinience but in reality, the worked time is formated in ms.
- ```currentlyWorking``` gets set to ```false``` by default.
- ```lastSeen``` gets set to ```Field(0)``` by default, once again a value in ms.

If a worked has already been hired for the said leaf, then the TX does not complete and no states are changes on chain.

When the worker will punch in for the first time, his working status will switch to true and his last seen
time stamp will be set to the oracle provided time, which now, only the worker knows for sure in a 100% 
accurate manner.

## The contracts

### ClockVerifier

Clock verifier acts a simple truth holder, to prove that the off-chain storage is indeed authentic 
and was never tempered with in other ways than the ones implemented in the contract's methods.

ClockVerifier requires the server to be the one executing the TX to ensure proper sync for a fully
functionning application.

> Note : ClockVerifier inherits from GetTime's logic to verify the oracle's time stamps on the fly. This allows for better visibility and testing.

### GetTime

The GetTime contract servers as a verifier for the authenticity of the time stamps provided by the
Worker through the use of the oracle.

> Note : the oracle public public is hardcoded a a single server is trusted, if you deploy your own oracle, you
will have to regenerate a key pair and hardcode the public when deploying.

# Commands

```sh
npm run build # build project
npm run test # test project
npm run testw # watch mode
npm run coverage # monitor test coverage
```