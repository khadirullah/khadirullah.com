# khadirullah.com

My personal portfolio and blog, built with [Hugo](https://gohugo.io/) and the [Blowfish](https://blowfish.page/) theme. Hosted on [Cloudflare Pages](https://pages.cloudflare.com/).

## Tech Stack

| Layer | Technology |
|---|---|
| Static Site Generator | [Hugo](https://gohugo.io/) |
| Theme | [Blowfish](https://blowfish.page/) |
| Hosting | [Cloudflare Pages](https://pages.cloudflare.com/) |
| DNS & CDN | [Cloudflare](https://www.cloudflare.com/) |
| Email Auth | SPF, DKIM, DMARC |
| Diagram Viewer | [DiagView](https://github.com/khadirullah/diagview) (my own project) |

## Features

- 🌑 Dark mode with the Ocean color scheme
- 🔍 Full-text search
- 📱 Fully responsive
- 📊 Mermaid diagram support with interactive DiagView
- 📤 Social sharing (LinkedIn, X, Reddit, Email)
- 🏷️ Tags and categories with card views
- 📄 Standalone HTML resume with print-to-PDF

## Local Development

```bash
# Clone with submodules (Blowfish theme)
git clone --recurse-submodules https://github.com/khadirullah/khadirullah.com.git

# Start dev server
hugo server -D
```

## Deployment

Connected to Cloudflare Pages. Pushing to `main` triggers automatic deployment.

## License

Content © Khadirullah Mohammad. Theme © [Blowfish](https://github.com/nunocoracao/blowfish).
