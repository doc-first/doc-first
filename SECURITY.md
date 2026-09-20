# Security

## Reporting

Report privately, through GitHub's **Report a vulnerability** button on the Security tab of this
repository. Please do not open a public issue for something exploitable.

Expect an acknowledgement within a week. This is a small project — that is the honest number, not
an SLA.

## What this software touches

Worth knowing before you run it:

- **It stores approvals, and approvals are evidence.** The database refuses `UPDATE` and `DELETE`
  through triggers, so nothing is erased even by someone opening the file with another program.
- **It serves your documentation over HTTP.** With password identity there is no edge protecting
  it: the guard is in the application. Without a session, every static page redirects to the login
  screen. That guard has a test in the HTTP contract suite, because it was once missing.
- **It stores passwords** with scrypt, per-user salt, and constant-time comparison. A test asserts
  the password does not appear in the raw database file.
- **The first-access password is random**, printed once, and must be changed at first login. There
  is no default account.

## Running it safely

- **Put it behind TLS.** The session cookie is `Secure` outside development, which means it will not
  travel over plain HTTP anywhere but localhost.
- **Use a named volume for `/data`**, not a host folder. A host folder arrives with the host's
  ownership, and the process runs as an unprivileged user.
- **Never put a key in `doc-first.json`.** That file is versioned. Secrets go in the environment or
  in `.env`, which is git-ignored.

## Known limits

- The agent's CLI can read the event store directly, bypassing the API — and therefore the cycle,
  the roles and the limits. It only reads, and it is marked in the code. The right fix is the agent
  having an identity of its own.
- Identity is password or an identity proxy. OIDC, Google and LDAP are not implemented.
