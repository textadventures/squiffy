import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";
import { compile } from "squiffy-compiler";
import { createPackage } from "@textadventures/squiffy-packager";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve paths relative to the monorepo root
const rootDir = path.resolve(__dirname, "../..");
const examplesDir = path.join(rootDir, "examples");
const outputDir = path.join(__dirname, "../public/examples");

interface ExternalFiles {
    getMatchingFilenames(pattern: string): Promise<string[]>;
    getContent(filename: string): Promise<string>;
    getLocalFilename(filename: string): string;
}

const externalFiles = (inputFilename: string): ExternalFiles => {
    const includedFiles = [path.resolve(inputFilename)];
    const basePath = path.resolve(path.dirname(inputFilename));
    return {
        getMatchingFilenames: async (pattern: string): Promise<string[]> => {
            const filenames = path.join(basePath, pattern);
            const result = await glob(filenames);
            return result.filter((filename: string) => !includedFiles.includes(filename));
        },
        getContent: async (filename: string): Promise<string> => {
            // Resolve relative paths against the base path
            const resolvedPath = path.isAbsolute(filename) ? filename : path.join(basePath, filename);
            includedFiles.push(resolvedPath);
            return (await fs.promises.readFile(resolvedPath)).toString();
        },
        getLocalFilename(filename: string): string {
            return path.relative(basePath, filename);
        }
    };
};

async function packageExample(inputPath: string, exampleName: string) {
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
            return false;
        }

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
        return true;
    } catch (error) {
        console.error(`  ✗ Error packaging ${exampleName}:`);
        console.error(`    ${error instanceof Error ? error.message : String(error)}`);
        return false;
    }
}

async function buildAllExamples() {
    console.log("Building example packages...");
    console.log(`Examples directory: ${examplesDir}`);
    console.log(`Output directory: ${outputDir}`);

    // Find all .squiffy files in examples directory
    const exampleFiles = await glob("**/*.squiffy", { cwd: examplesDir });

    if (exampleFiles.length === 0) {
        console.log("No example files found.");
        return;
    }

    console.log(`Found ${exampleFiles.length} example(s):`);
    exampleFiles.forEach(file => console.log(`  - ${file}`));

    let successCount = 0;
    let failCount = 0;

    for (const file of exampleFiles) {
        const inputPath = path.join(examplesDir, file);
        // Get the example name from the directory name
        const exampleName = path.dirname(file);

        const success = await packageExample(inputPath, exampleName);
        if (success) {
            successCount++;
        } else {
            failCount++;
        }
    }

    console.log(`\n✅ Build complete: ${successCount} succeeded, ${failCount} failed`);

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
