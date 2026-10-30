# Unreleased

## Cloud accounts

- **Add AWS account** and **Add Google Cloud account**, in a **Cloud
  accounts** group in Settings > Secrets and under **Accounts** in the
  Cloud view (and in the command palette). Each says where to make the key
  in the provider's console; the name and an AWS region are filled in, and a
  Google Cloud key file can be chosen instead of pasted.
- **Check** asks the cloud who the key signs in as, straight after saving
  and whenever you like: the AWS account and user, or whether a Google Cloud
  key signs in and can use Compute Engine. A key that signs in but cannot
  be used yet is marked **Needs setup** with what to fix, kept until a
  clean check; an error shows on the account, and a key the cloud refuses
  stops showing as checked. Checking changes nothing and costs nothing.
- An account says when the `aws` or `gcloud` command it needs is missing,
  with a link to install it.
- A new user's Cloud view starts at adding an account.
- Built on NullBot with `CheckCloudAccount` and accounts in `InfraState`.
- The account buttons name their account for screen readers (Check aws-lab).
