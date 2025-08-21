# Squiffy

**Squiffy is under reconstruction. The `main` branch is currently a work in progress.**

**For the current production version of Squiffy, see the [`v5` branch](https://github.com/textadventures/squiffy/tree/v5).**

---

This project is organised as a monorepo. After cloning, you can run the following to install all dependencies and build all projects:

```bash
npm install
npm run build
```

| Folder        | Package name                          | Type            | Description                                                                                             |
|---------------|---------------------------------------|-----------------|---------------------------------------------------------------------------------------------------------|
| `compiler`    | `squiffy-compiler`                    | Package         | Squiffy compiler, which converts Squiffy scripts into JavaScript                                        |
| `editor`      | `@textadventures/squiffy-editor`      | Web app         | Squiffy editor, `app.squiffystory.com` - a web-based interface for creating and editing Squiffy scripts |
| `packager`    | `squiffy-packager`                    | Package and CLI | Squiffy packager, which calls the compiler and packages the output into HTML, CSS and JS                |
| `runtime`     | `squiffy-runtime`                     | Package         | Squiffy runtime, which provides the JavaScript library for running Squiffy scripts                      |
| `site`        | `site`                                | Web app         | Squiffy website, `squiffystory.com`                                                                     |
| `types`       | `@textadventures/squiffy-types`       | Package         | Type definitions used by the Vite plugin                                                                |
| `vite-plugin` | `@textadventures/vite-plugin-squiffy` | Package         | Vite plugin, allowing you to build Squiffy scripts as part of a web app                                 |

There is also an `examples` folder which contains some sample Squiffy scripts.