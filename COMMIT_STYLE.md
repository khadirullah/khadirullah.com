Here's your commit format going forward:

### For new blog posts:
```
blog: add <short-description> (<folder-name>)
```
Example:
```
blog: add Amazon Linux 2023 QEMU/KVM local lab guide (amazon-linux-qemu-local-lab)
```

### For blog updates:
```
blog: update <short-description> (<folder-name>)
```
Example:
```
blog: update Cloud-Init password section (amazon-linux-qemu-local-lab)
```

### For non-blog changes:
```
feat: <description>
fix: <description>
```
Examples:
```
feat: add dark mode toggle to resume page
fix: broken OG image path in hugo.toml
```

Simple, consistent, searchable.

### 📝 Writing Detailed Commit Bodies

For complex updates or fixes, separate the title from the body with a blank line and use present-tense bullet points to explain **what** changed and **why**:

```text
blog: update Open Graph SVG fallbacks to lossless WEBP (all-posts)

- Generate perfectly lossless social-fallback.webp images for 10 blog posts
- Inject images array into YAML front matter to fix social link previews
- Rename fallback images to bypass Blowfish wildcard matching
```
