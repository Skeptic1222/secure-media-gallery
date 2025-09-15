import { Octokit } from '@octokit/rest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let connectionSettings;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
// Always call this function again to get a fresh client.
async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

// Function to get all files recursively
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach(file => {
    const filePath = path.join(dirPath, file);
    
    // Skip certain directories and files
    if (file === 'node_modules' || 
        file === '.git' || 
        file === 'uploads' || 
        file === '.replit' ||
        file === 'replit.nix' ||
        file.startsWith('.') && file !== '.env.example') {
      return;
    }

    if (fs.statSync(filePath).isDirectory()) {
      arrayOfFiles = getAllFiles(filePath, arrayOfFiles);
    } else {
      arrayOfFiles.push(filePath);
    }
  });

  return arrayOfFiles;
}

// Function to read file content as base64
function getFileContent(filePath) {
  const content = fs.readFileSync(filePath);
  return content.toString('base64');
}

async function createRepository() {
  try {
    const octokit = await getUncachableGitHubClient();
    
    // Get user info
    const { data: user } = await octokit.rest.users.getAuthenticated();
    console.log(`Authenticated as: ${user.login}`);

    // Create repository
    const repoName = 'secure-media-gallery';
    console.log(`Creating repository: ${repoName}`);
    
    const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'Secure media gallery web application with advanced categorization, encryption vault, and multi-database support',
      private: false, // Set to true if you want a private repo
      auto_init: false
    });

    console.log(`Repository created: ${repo.html_url}`);

    // Get all project files
    const projectRoot = path.resolve(__dirname, '..');
    const allFiles = getAllFiles(projectRoot);
    
    console.log(`Found ${allFiles.length} files to upload`);

    // Create files in repository
    for (const filePath of allFiles) {
      const relativePath = path.relative(projectRoot, filePath);
      console.log(`Uploading: ${relativePath}`);
      
      try {
        const content = getFileContent(filePath);
        
        await octokit.rest.repos.createOrUpdateFileContents({
          owner: user.login,
          repo: repoName,
          path: relativePath,
          message: `Add ${relativePath}`,
          content: content
        });
      } catch (error) {
        console.error(`Error uploading ${relativePath}:`, error.message);
      }
    }

    console.log('\n✅ Repository created and files uploaded successfully!');
    console.log(`🔗 Repository URL: ${repo.html_url}`);
    console.log(`📁 Clone URL: ${repo.clone_url}`);
    
    return repo;
  } catch (error) {
    console.error('❌ Error creating repository:', error.message);
    throw error;
  }
}

// Run the script
createRepository().catch(console.error);