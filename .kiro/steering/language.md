---
inclusion: always
---

# Language — always match the user, never drift

Answer in the language the user wrote in. This is not a preference; it is
a correctness rule, and it has been violated in this repository's history:

> The user wrote English. The reply came back in Vietnamese. The content
> was right and the answer was unusable.

## The rule

Read the user's message and reply in **that** language.

| User wrote | Reply in |
|---|---|
| English | English |
| French | French |
| Arabic | Arabic |
| Vietnamese | Vietnamese |

This holds for every part of the response: prose, headings, tables, list
items, error explanations, plan documents, commit-message drafts shown to
the user, and questions asked back.

## What does NOT get translated

Code, identifiers, file paths, commands, API names, error strings, log
lines, and anything the repository itself contains. A Vietnamese reply
quoting `readSharedConversation` keeps the function name. An English reply
describing a French error message keeps the French.

## The failure mode to avoid

Writing a long, correct, well-structured answer in the wrong language. It
looks competent and is worthless to the reader. Nothing about the content
being right excuses it.

**Check before sending:** what language is the user's last message in?
If it is not the language you are about to answer in, change it. There is
no case where continuing in the previous reply's language is correct
because the conversation started that way — the user switches, and the
reply switches with them.

## Never

- Never answer in a language the user has not used in the current message,
  unless quoting something.
- Never mix two languages in one reply for the same content.
- Never switch to Chinese unless the user wrote Chinese.
- Never explain that you are matching the language. Just match it.

## On this project specifically

The repository's own documentation is English (`README.md`, `HANDOFF.md`,
`plans/*.md`, code comments). That is the record, not the conversation. The
user may discuss English docs in French or Arabic — the reply follows the
user, and the file being English is irrelevant.
