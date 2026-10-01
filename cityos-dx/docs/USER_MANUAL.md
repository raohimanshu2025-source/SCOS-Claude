# User manual

This manual is for the people who use the console: the DX administrator, data officers of provider departments, consumers, ICCC operators, auditors and analytics providers. All data in the demo city is synthetic.

## 1. Signing in

1. Open the console address (for the demo, https://localhost:8443).
2. Enter your username and password. The administrator gives you these.
3. On first login you must choose a new password: at least 12 characters, with letters and digits.
4. After 5 wrong passwords the account locks for 15 minutes. The administrator can unlock it sooner.
5. Use **Log out** (top right) when you finish. Sessions end on their own after 8 hours.

Your account is linked to your X.509 certificate. Everything you do in the console is done as that certificate holder and is written to the signed audit log. Computer systems (apps, resource servers) do not use the console; they call the same API with their certificate over TLS.

## 2. Screens by role

| Screen | Admin | Data officer | Consumer | ICCC operator | Auditor | Analytics provider |
|---|---|---|---|---|---|---|
| Overview | yes | yes | yes | yes | yes | yes |
| Catalogue | yes | yes | yes | yes | yes | yes |
| Data access | public items only (no certificate) | yes | yes | yes | public items only | yes |
| Provider console | | yes | | | | |
| City intelligence | yes | yes | yes | yes | yes | yes, and plug in analytics |
| ICCC dashboard | yes | | | yes | yes | |
| Certificates and trust | yes (decide) | | | | yes (view) | |
| Operations and audit | yes | | | | yes (view) | |
| Status page | yes | yes | yes | yes | yes | yes |

## 3. Catalogue (everyone)

Search by words, by tag (for example `flood`), by type, or by an area written as `west,south,east,north`. Click a result to see the full catalogue entry (a JSON-LD document) and its data model with units. **Notify me of changes** puts a notice in your inbox when the entry changes (BIS 4.3).

## 4. Data access (consumers)

1. **Request a token.** Paste the item id (for example `urn:demo-cat:drains/drain-1`) and a purpose, then press **Request token**.
   - If the provider's policy already lists you, you get a token at once. It looks like `auth.demo-city.example/you@your.domain/…` and lasts one hour.
   - If not, a consent request goes to the provider. You see its number (CR-…) under **My consent requests**, and a notice arrives in your inbox when the provider decides.
   - Your certificate class limits what you can reach: protected data needs class 2, 4 or 5; private data class 4 or 5; confidential data class 5 (BIS 5.4.2).
2. **Read data.** The item id and token are filled in for you. Choose latest, search, count, status or download and press **Send**. The numbered steps shown follow BIS Figure 2.
3. The token only works with your own certificate. Keep it private. **My tokens** lists your tokens with their status and how often they were used.

Public items (for example air quality and bus positions) need no token.

## 5. Provider console (data officers)

- **Consent requests.** Each request shows who asked, their certificate class, the item and the purpose. Press **Approve** or **Reject**. Approving adds the consumer to the item's policy.
- **Policy of an item.** Load one of your items to see its policy P = (C, A). Change the label (public, protected, private, confidential), the list of consumers C, and the Table 3 attributes. A new policy, or a changed label, starts from that label's column of Table 4, word for word (for example "Needs audit"); you can then pick Table 3 values instead. Only the certificate that created an item can change it or its policy (BIS 5.3). Consumers you remove lose their tokens.
- **Licence agreement.** Record an agreement with an app developer (app name, developer e-mail, terms). The developer then gets tokens without separate consent. Ending it ends those tokens.
- **Revoke a consumer.** Ends all of that consumer's tokens for the item and removes them from the policy (BIS 7.6).
- **All consent and data flows.** Every token issued for your items, its status and use count (BIS 5.6).
- **Your department's datasets.** Add your department's provider entry, a dataset group (one data model and one resource server), datasets in a group (name, description, tags, access label, optional location), and data rows. Paste rows as CSV with a header line or as a JSON list; column names must match the data model, and the server refuses rows that do not.

Creating and changing catalogue entries and pushing data is done through the API with your class 3 certificate (see TECHNICAL.md section 4).

## 6. City intelligence (everyone)

- **Call an API.** Choose one of the 19 domain APIs, optionally edit the request body, press **Call**. Grids are drawn as a heat map (north at top); tables are shown as tables. **Show OpenAPI** shows the API's description with its ontology terms.
- APIs that use protected data (drains, grievance counts, waste) need you to have data exchange access to those items, the same as reading them directly.
- **Ask a question.** Type a question about grievances, drains, buses, air, waste or temperature. The answer names the API used. This matches keywords; it is not a language model.
- **OLAP.** Pivot grievances, waste or alerts by ward, day and category.
- **Plug in an analytic** (analytics providers and data officers). Give the full specification in JSON. The server checks the ontology terms and that each input attribute exists in the catalogue's data model before accepting it. Accepted analytics get their own API and run on schedule.
- **Federation.** Asks the same API of every connected city and shows each answer and the aggregate.

## 7. ICCC dashboard (operators)

Latest alerts raised by analytics, and the monthly report: API use, alerts by domain and uptime.

## 8. Certificates and trust (administrator)

- **Certificate requests.** Requests arrive by the API (standing in for the e-mail in BIS 7.1). An organisation's own certificate can also approve its employees' requests through the API (it acts as registration authority, BIS 5.4.2); it cannot be used for anything else. They are already checked for the subject "Certificate request", a white-listed organisation, matching e-mail domain and allowed class. Enter the request id and press **Approve and issue** or **Reject**.
- **Issued certificates.** Revoke a certificate by serial and reason. It goes on the revocation list at once and every request made with it is refused. Tokens issued to it stop working.
- **Revocation list** and **trusted certificate authorities** are shown and can be downloaded.
- **Organisations.** Registered organisations and whether they are white-listed. Registration is done through the API.
- **Add a department.** Registers and white-lists it and issues its organisation certificate in one step, so its staff can have certificates.
- **Add a person.** Issues a certificate (data officer class 3, employee class 2-5, or individual class 2) and a login with a temporary password, which must be changed at first login. The e-mail domain must belong to a white-listed department.
- **Logins.** All accounts, with an Unlock button for locked ones.

## 9. Operations and audit (administrator, auditor)

- **Audit log.** Latest events with interface, actor, action and result. The line at the top says whether the whole chain of hashes and signatures still verifies. Any edit to a past entry breaks the chain at that entry.
- **Statistics** per interface.
- **Backups** (administrator). Take a backup now; each is checked for integrity.
- **Service drills** (administrator). Pause and resume a service to rehearse the failure cases in BIS 5.6. Always resume afterwards.

## 10. Status page (everyone)

Uptime, average response time and 95th-percentile latency per service over the last 24 hours. The same data is at `/status/v1` for machines, and `/status/v1/heartbeat` gives the live state.
