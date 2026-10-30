# OpenMail

OpenMail is a responsive product concept website with a cinematic, animated visual system and a usable in-browser inbox prototype. It is built with plain HTML, CSS, and JavaScript: no build step, framework, or package install is required.

## Run locally

From this directory, start a local web server:

```sh
python3 -m http.server 4173
```

Open [http://localhost:4173](http://localhost:4173) and stop the server with `Ctrl+C`.

## What the preview does

- Browse All Mail, Primary, Social, Promotions, Updates, Spam, Starred, Sent, Drafts, Archive, and Trash.
- Search fictional sample content, change the sort order, open messages, mark them unread, and star them.
- Select multiple messages to mark read or unread, archive, move to Spam, or move to Trash. Archived, spam, and trashed samples can be moved back to the inbox.
- Compose, autosave and edit local drafts, reply to a sample message, and add a message to the local Sent view.
- Adjust compact row preferences and reset the sample inbox from Preview settings.
- Keep demo changes in this browser using local storage. They do not leave the device. “Preview send” never delivers an email.
- Explore the animated signal globe, layered system diagram, scroll reveals, responsive navigation, and reduced-motion support.

Every inbox message and address is fictional. This is a front-end product preview, not a live mail client. It does not connect to accounts, deliver or receive email, or save data on a server. The mailbox, identity, storage, domain connection, message transport, spam controls, security, and operations shown on the website are concept and roadmap items.

## Project files

- `index.html` — page structure, content, and inbox preview shell.
- `styles.css` — responsive visual design, motion, and inbox/dialog styling.
- `app.js` — interactive inbox demo, local persistence, navigation, and animations.
- `favicon.svg` — OpenMail mark.

Google Fonts load from Google when a connection is available; system font fallbacks are included.

## GitHub and Vercel

- GitHub repository: [Piyush70007/openmail-site](https://github.com/Piyush70007/openmail-site)
- Live preview: [openmail-site.vercel.app](https://openmail-site.vercel.app/)

The repository is connected to Vercel. The site is served from the repository root with the **Other** framework preset, no build command, and `.` as the output directory. Pushing to `main` triggers a production deployment.

Launching a real email service is a separate engineering phase. It requires choosing a mail transport and storage architecture, implementing authentication and mailbox integrations, setting up and verifying a domain, and building abuse prevention, security, backups, and operations. Do not add credentials or private email data to this static project.
