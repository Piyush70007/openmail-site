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

## Publish with GitHub and Vercel

This folder is a standalone site, and no GitHub repository or deployment is currently connected. To publish it:

1. Create a GitHub repository and place the contents of `outputs/openmail-site` at its root, or commit this parent project and keep this subfolder.
2. Import that repository into Vercel.
3. If the repository contains the parent project, set Vercel's Root Directory to `outputs/openmail-site`. If this folder is the repository root, use `.`.
4. Select **Other** as the framework preset. Leave the build command empty and set the output directory to `.`.
5. Deploy. The result is a static marketing site; it does not provision mailboxes or run an email server.

Before presenting the concept as a live email service, the product still needs its mail transport, domain setup, account and message storage, spam controls, security implementation, and operational support. This website labels these items as planned and does not claim they are already available.
