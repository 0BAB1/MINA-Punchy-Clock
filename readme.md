# PUNCHY : The privacy-driven punch clock solution

Punchy is a punch clock solution based on the Mina blockchain and o1js framework by empowering MerkleTrees.

Punch clocks can be the source of problems when it come to everyday office life, from the worker
fear of being tracked to the employer fear of employees cheating by using tricks,
we can sometimes diverge from the initial idea of a simple legal proof of the worked
hours to emit a paycheck.

Punchy aims at implementing the punch clock system unsing the Mina blockchain as a trust party.

### Solution actors and stakeholders :
- The on chain contracts
- A dedicated oracle for authentic time stamps
- A server to hold the data
- And of course : the Workers and employer that can lack trust in each other

### Main solution requirements :

- Only reveal what's necessary as public states :
  - The worker public key.
  - The number of worker hours.
- Prevent worker from punching the clock for a colleague.
- Prevent workers form cheating on their status (working or not) or their worked hours.
- Allow employers to check on the employee worker hours at any time with complete trust.
- Both the server and the user agrees on transaction by signing the data (prevents cheating and de-sync of the truthy tree)

# The protocol

Punchy's protocol is describe with more details here : [Contracts README file](./contracts/README.md). Here is a broad overview of how the protocol handles transaction and ensure the requirements are met :

![Protocole image](https://image.noelshack.com/fichiers/2024/40/6/1728111893-capture-d-cran-du-2024-10-05-09-04-03.png)