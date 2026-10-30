# OpenMail website concept

A responsive, static landing page and interactive inbox preview for OpenMail. It uses plain HTML, CSS, and JavaScript, with no build step or package dependencies.

## Run locally

From this directory, start a local web server:

```sh
python3 -m http.server 4173
```

Then visit [http://localhost:4173](http://localhost:4173). Stop the server with `Ctrl+C`.

## Interactions in the preview

- Switch between All Mail, Primary, Social, Promotions, Updates, and Spam.
- Search the fictional messages, reorder unread messages, select rows, and star messages.
- Open a sample message or the compose window. Composing is local UI only; it does not send or save anything.
- On desktop, move the pointer over the hero signal and system layers. Scroll to reveal the diagrams and track page progress.
- On mobile, use the menu button to navigate between sections.

The page honors the system's reduced-motion setting. Google Fonts are loaded remotely when available and have system font fallbacks.

## GitHub and Vercel

The site is connected to [Piyush70007/openmail-site](https://github.com/Piyush70007/openmail-site) and deployed at [openmail-site.vercel.app](https://openmail-site.vercel.app/). Commits pushed to `main` trigger a Vercel production deployment. This is a static marketing site; it does not provision mailboxes or run an email server.

Vercel serves the repository root directly: the framework preset is **Other**, with no build command and `.` as the output directory.

Before presenting the concept as a live email service, the product still needs its mail transport, domain setup, account and message storage, spam controls, security implementation, and operational support. This website labels these items as planned and does not claim they are already available.
