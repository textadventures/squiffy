import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { compile } from "squiffy-compiler";
import { createPackage } from "@textadventures/squiffy-packager";
import { externalFiles } from "@textadventures/squiffy-cli";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve paths relative to the monorepo root
const rootDir = path.resolve(__dirname, "../..");
const examplesDir = path.join(rootDir, "examples");
const outputDir = path.join(__dirname, "../public/examples");

interface ExampleConfig {
    path: string;
    description?: string;
    featured?: boolean;
}

interface ExamplesManifest {
    examples: ExampleConfig[];
}

interface BuiltExample {
    name: string;
    title: string;
    description?: string;
    featured?: boolean;
}

async function packageExample(inputPath: string, exampleName: string, config: ExampleConfig): Promise<BuiltExample | null> {
    console.log(`\nPackaging ${exampleName}...`);

    try {
        const inputText = fs.readFileSync(inputPath, "utf-8");

        // Compile the example
        const result = await compile({
            scriptBaseFilename: path.basename(inputPath),
            script: inputText,
            onWarning: (message) => console.warn(`  Warning: ${message}`),
            externalFiles: externalFiles(inputPath),
            globalJs: true,
        });

        if (!result.success) {
            console.error(`  ✗ Failed to compile ${exampleName}:`);
            result.errors.forEach(error => console.error(`    ${error}`));
            return null;
        }

        // Get title from the story
        const uiInfo = result.getUiInfo();
        const title = uiInfo.title || exampleName;

        // Create package
        const pkg = await createPackage(result, false);

        // Write output files
        const exampleOutputDir = path.join(outputDir, exampleName);
        fs.mkdirSync(exampleOutputDir, { recursive: true });

        for (const [filename, content] of Object.entries(pkg.files)) {
            const outputPath = path.join(exampleOutputDir, filename);
            fs.writeFileSync(outputPath, content);
            console.log(`  ✓ ${filename}`);
        }

        console.log(`  ✓ Packaged to public/examples/${exampleName}/`);
        return { name: exampleName, title, description: config.description, featured: config.featured };
    } catch (error) {
        console.error(`  ✗ Error packaging ${exampleName}:`);
        console.error(`    ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

function generateIndexPage(examples: BuiltExample[]) {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Squiffy Examples</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            line-height: 1.6;
            color: #333;
            background: #f5f5f5;
            padding: 2rem;
        }
        .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 2rem;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #2c3e50;
            margin-bottom: 0.5rem;
        }
        .subtitle {
            color: #7f8c8d;
            margin-bottom: 2rem;
        }
        .example-grid {
            display: grid;
            gap: 1rem;
        }
        .example-card {
            border: 1px solid #e0e0e0;
            border-radius: 4px;
            padding: 1.25rem;
        }
        .example-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #2c3e50;
            margin-bottom: 0.25rem;
        }
        .example-description {
            font-size: 0.9rem;
            color: #555;
            margin-bottom: 0.5rem;
        }
        .example-links {
            font-size: 0.875rem;
            display: flex;
            gap: 1rem;
        }
        .example-links a {
            color: #3498db;
            text-decoration: none;
        }
        .example-links a:hover {
            text-decoration: underline;
        }
        .footer {
            margin-top: 2rem;
            padding-top: 1rem;
            border-top: 1px solid #e0e0e0;
            text-align: center;
            color: #7f8c8d;
            font-size: 0.875rem;
        }
        .footer a {
            color: #3498db;
            text-decoration: none;
        }
        .footer a:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Squiffy Examples</h1>
        <p class="subtitle">${examples.length} example${examples.length !== 1 ? "s" : ""}</p>

        <div class="example-grid">
${examples.map(ex => `            <div class="example-card">
                <div class="example-title">${ex.title}</div>
                ${ex.description ? `<div class="example-description">${ex.description}</div>` : ""}
                <div class="example-links">
                    <a href="${ex.name}/index.html">Play</a>
                    <a href="https://github.com/textadventures/squiffy/tree/main/examples/${ex.name}" target="_blank">View Source</a>
                </div>
            </div>`).join("\n")}
        </div>

        <div class="footer">
            <p><a href="https://squiffystory.com" target="_blank">Squiffy Documentation</a></p>
        </div>
    </div>
</body>
</html>`;

    const indexPath = path.join(outputDir, "index.html");
    fs.writeFileSync(indexPath, html);
    console.log(`\n✓ Generated index.html with ${examples.length} example(s)`);
}

async function buildAllExamples() {
    console.log("Building example packages...");
    console.log(`Examples directory: ${examplesDir}`);
    console.log(`Output directory: ${outputDir}`);

    // Read examples manifest
    const manifestPath = path.join(examplesDir, "examples.json");
    const manifestContent = fs.readFileSync(manifestPath, "utf-8");
    const manifest: ExamplesManifest = JSON.parse(manifestContent);

    const exampleConfigs = manifest.examples;

    if (exampleConfigs.length === 0) {
        console.log("No examples configured in examples.json");
        return;
    }

    console.log(`Found ${exampleConfigs.length} configured example(s):`);
    exampleConfigs.forEach(config => console.log(`  - ${config.path}`));

    let successCount = 0;
    let failCount = 0;
    const builtExamples: BuiltExample[] = [];

    for (const config of exampleConfigs) {
        const inputPath = path.join(examplesDir, config.path);
        // Get the example name from the directory name
        const exampleName = path.dirname(config.path);

        const result = await packageExample(inputPath, exampleName, config);
        if (result) {
            successCount++;
            builtExamples.push(result);
        } else {
            failCount++;
        }
    }

    console.log(`\n✅ Build complete: ${successCount} succeeded, ${failCount} failed`);

    // Generate index page for successfully built examples
    if (builtExamples.length > 0) {
        // Sort examples: featured first, then alphabetically by name
        builtExamples.sort((a, b) => {
            if (a.featured && !b.featured) return -1;
            if (!a.featured && b.featured) return 1;
            return a.name.localeCompare(b.name);
        });
        generateIndexPage(builtExamples);
    }

    // Only fail the build if no examples succeeded
    if (successCount === 0) {
        console.error("❌ All examples failed to build!");
        process.exit(1);
    }

    if (failCount > 0) {
        console.warn(`⚠️  ${failCount} example(s) failed but continuing build...`);
    }
}

buildAllExamples().catch(error => {
    console.error("Build failed:", error);
    process.exit(1);
});
