/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { db } from './database.js';
import { Memory, Relationship } from '../types.js';

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  html_url: string;
  description: string;
  language: string;
  stargazers_count: number;
}

interface ParsedClass {
  name: string;
  docstring: string;
  codeSnippet: string;
  methods: string[];
}

interface ParsedFunction {
  name: string;
  params: string;
  docstring: string;
  codeSnippet: string;
  belongsToClass?: string;
}

interface ParsedFile {
  filePath: string;
  fileName: string;
  imports: string[];
  classes: ParsedClass[];
  functions: ParsedFunction[];
}

function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const map: Record<string, string> = {
    py: 'Python', js: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript/React',
    jsx: 'JavaScript/React', json: 'JSON', md: 'Markdown', txt: 'Text',
    html: 'HTML', css: 'CSS', scss: 'SCSS', yaml: 'YAML', yml: 'YAML',
    toml: 'TOML', env: 'Env', sh: 'Shell', rs: 'Rust', go: 'Go',
    java: 'Java', rb: 'Ruby', php: 'PHP', swift: 'Swift', kt: 'Kotlin',
    cpp: 'C++', c: 'C', cs: 'C#', sql: 'SQL', dockerfile: 'Docker',
  };
  return map[ext] || ext.toUpperCase() || 'Unknown';
}

/**
 * Fetch list of repositories for a given user or authenticated account
 */
export async function listGitHubRepos(token?: string, username?: string): Promise<GitHubRepo[]> {
  let url = 'https://api.github.com/user/repos?per_page=100&sort=updated';
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Layon-System-Brain-Analyst'
  };

  if (token && token.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`;
  } else if (username && username.trim()) {
    url = `https://api.github.com/users/${username.trim()}/repos?per_page=100&sort=updated`;
  } else {
    throw new Error('Por favor, informe um Token do GitHub ou um Nome de Usuário.');
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 403) {
      if (errorText.toLowerCase().includes('rate limit') || res.headers.get('x-ratelimit-remaining') === '0') {
        throw new Error('Limite de requisições anônimo do GitHub excedido para o IP desse servidor. Por favor, insira um "GitHub Personal Token" para listar com segurança.');
      }
      throw new Error(`Acesso Negado (403): Permissões insuficientes para obter repositórios.`);
    } else if (res.status === 401) {
      throw new Error('O Token Pessoal do GitHub fornecido é inválido, expirou ou foi revogado.');
    } else if (res.status === 404) {
      throw new Error(`Usuário do GitHub "${username}" não foi encontrado. Verifique a grafia e tente novamente.`);
    }
    throw new Error(`Erro da API do GitHub: ${res.statusText} (${errorText})`);
  }

  return await res.json() as GitHubRepo[];
}

/**
 * Parses file contents (JS, TS, Python) to extract dependencies, classes, and functions.
 */
export function parseFileCode(filePath: string, content: string): ParsedFile {
  const fileName = filePath.split('/').pop() || filePath;
  const extension = fileName.split('.').pop()?.toLowerCase() || '';

  const importsObj = new Set<string>();
  const classes: ParsedClass[] = [];
  const functions: ParsedFunction[] = [];

  const lines = content.split('\n');

  if (['py'].includes(extension)) {
    lines.forEach(line => {
      const importMatch = line.match(/^\s*(?:import\s+(\w+)|from\s+(\w+)\s+import)/);
      if (importMatch) {
        const dep = importMatch[1] || importMatch[2];
        if (dep && dep.length > 1) importsObj.add(dep);
      }
    });

    let currentClass: ParsedClass | null = null;
    let currentBlock: string[] = [];
    let currentBlockType: 'class' | 'func' | null = null;
    let currentBlockName = '';
    let currentBlockParams = '';
    let currentBlockDoc = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const classMatch = line.match(/^class\s+([A-Za-z0-9_]+)(?:\(([^)]+)\))?:/);
      const defMatch = line.match(/^(\s*)def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)(?:\s*->\s*[^:]+)?:/);

      if (classMatch) {
        if (currentBlockType === 'class' && currentClass) {
          currentClass.codeSnippet = currentBlock.join('\n');
          classes.push(currentClass);
        } else if (currentBlockType === 'func') {
          functions.push({ name: currentBlockName, params: currentBlockParams, docstring: currentBlockDoc, codeSnippet: currentBlock.join('\n'), belongsToClass: currentClass ? currentClass.name : undefined });
        }
        const className = classMatch[1];
        currentClass = { name: className, docstring: '', codeSnippet: '', methods: [] };
        currentBlock = [line];
        currentBlockType = 'class';
        currentBlockName = className;
        currentBlockDoc = '';
        if (i + 1 < lines.length && lines[i + 1].trim().startsWith('"""')) {
          let j = i + 1;
          let doc = lines[j].trim();
          if (doc.endsWith('"""') && doc.length > 6) {
            currentClass.docstring = doc.replace(/"""/g, '').trim();
          } else {
            const docLines: string[] = [];
            while (j < lines.length) { docLines.push(lines[j]); if (j > i + 1 && lines[j].includes('"""')) break; j++; }
            currentClass.docstring = docLines.join('\n').replace(/"""/g, '').trim();
          }
        }
      } else if (defMatch) {
        if (currentBlockType === 'class' && currentClass) { currentClass.codeSnippet = currentBlock.join('\n'); classes.push(currentClass); }
        else if (currentBlockType === 'func') { functions.push({ name: currentBlockName, params: currentBlockParams, docstring: currentBlockDoc, codeSnippet: currentBlock.join('\n'), belongsToClass: currentClass ? currentClass.name : undefined }); }
        const indent = defMatch[1];
        const funcName = defMatch[2];
        const params = defMatch[3];
        if (indent.length > 0 && currentClass) currentClass.methods.push(funcName);
        currentBlock = [line];
        currentBlockType = 'func';
        currentBlockName = funcName;
        currentBlockParams = params;
        currentBlockDoc = '';
        if (i + 1 < lines.length && lines[i + 1].trim().startsWith('"""')) {
          let j = i + 1;
          const docLines: string[] = [];
          while (j < lines.length) { docLines.push(lines[j]); if (lines[j].trim().endsWith('"""') && (j > i + 1 || lines[j].trim().length > 3)) break; j++; }
          currentBlockDoc = docLines.join('\n').replace(/"""/g, '').trim();
        }
      } else {
        if (currentBlockType) currentBlock.push(line);
      }
    }

    if (currentBlockType === 'class' && currentClass) { currentClass.codeSnippet = currentBlock.slice(0, 30).join('\n'); classes.push(currentClass); }
    else if (currentBlockType === 'func') { functions.push({ name: currentBlockName, params: currentBlockParams, docstring: currentBlockDoc, codeSnippet: currentBlock.slice(0, 30).join('\n'), belongsToClass: currentClass ? currentClass.name : undefined }); }

  } else if (['js', 'jsx', 'ts', 'tsx'].includes(extension)) {
    lines.forEach(line => {
      const importMatch = line.match(/import\s+(?:[\w\s{},*]+|type\s+[^;]+)\s+from\s+['"]([^'"]+)['"]/);
      const requireMatch = line.match(/(?:const|let|var)\s+[\w\s{},*]+\s*=\s*require\s*\(['"]([^'"]+)['"]\)/);
      if (importMatch || requireMatch) {
        const fullDep = importMatch ? importMatch[1] : requireMatch![1];
        if (fullDep && !fullDep.startsWith('.') && !fullDep.startsWith('/') && !fullDep.startsWith('@/')) {
          const baseName = fullDep.split('/')[0];
          importsObj.add(baseName);
        }
      }
    });

    let inClass = false;
    let className = '';
    let currentClassBlock: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const classMatch = line.match(/(?:export\s+)?class\s+([A-Za-z0-9_]+)/);
      if (classMatch) {
        inClass = true;
        className = classMatch[1];
        currentClassBlock = [line];
        classes.push({ name: className, docstring: `Classe: ${className}`, codeSnippet: lines.slice(i, i + 25).join('\n'), methods: [] });
      }

      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
      const arrowMatch = line.match(/(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);

      if (funcMatch || arrowMatch) {
        const name = funcMatch ? funcMatch[1] : arrowMatch![1];
        const params = funcMatch ? funcMatch[2] : arrowMatch![2];
        const snippet = lines.slice(i, i + 25).join('\n');
        let j = i - 1;
        let docLines: string[] = [];
        if (j >= 0 && lines[j].trim().includes('*/')) {
          while (j >= 0) { docLines.unshift(lines[j]); if (lines[j].trim().startsWith('/**')) break; j--; }
        }
        const docstring = docLines.length > 0 ? docLines.join('\n').replace(/\/\*\*|\*\/|\*/g, '').trim() : `Função mapeada: ${fileName}`;
        functions.push({ name, params, docstring, codeSnippet: snippet, belongsToClass: inClass ? className : undefined });
        if (inClass && classes.length > 0) classes[classes.length - 1].methods.push(name);
      }

      if (inClass) {
        currentClassBlock.push(line);
        if (line.trim().startsWith('}') && !line.includes('{') && currentClassBlock.length > 5) inClass = false;
      }
    }
  }

  return { filePath, fileName, imports: Array.from(importsObj), classes, functions };
}

/**
 * Extract dependencies from package.json or requirements.txt content
 */
function extractDependencies(filePath: string, content: string): { nome: string; tipo: string }[] {
  const deps: { nome: string; tipo: string }[] = [];
  const fileName = filePath.split('/').pop()?.toLowerCase() || '';

  if (fileName === 'package.json') {
    try {
      const pkg = JSON.parse(content);
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      for (const [nome] of Object.entries(allDeps)) {
        deps.push({ nome, tipo: 'npm' });
      }
    } catch (e) { /* invalid json */ }
  } else if (fileName === 'requirements.txt') {
    content.split('\n').forEach(line => {
      const clean = line.trim().replace(/[>=<!~].*/g, '').trim();
      if (clean && !clean.startsWith('#')) {
        deps.push({ nome: clean, tipo: 'pip' });
      }
    });
  } else if (fileName === 'cargo.toml') {
    const depSection = content.match(/\[dependencies\]([\s\S]*?)(?=\[|$)/);
    if (depSection) {
      depSection[1].split('\n').forEach(line => {
        const match = line.match(/^([a-z_-]+)\s*=/);
        if (match) deps.push({ nome: match[1], tipo: 'cargo' });
      });
    }
  } else if (fileName === 'go.mod') {
    content.split('\n').forEach(line => {
      const match = line.trim().match(/^require\s+(\S+)/);
      if (match) deps.push({ nome: match[1], tipo: 'go' });
    });
  }

  return deps;
}

/**
 * Synchronize a user repository — stores ALL files with full content and integrates into brain
 */
export async function syncGitHubRepoToBrain(
  owner: string,
  repo: string,
  branch: string,
  token?: string
): Promise<{ filesCount: number; classesCount: number; functionsCount: number; nodesAdded: number }> {
  
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'Layon-System-Brain-Analyst'
  };
  if (token && token.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`;
  }

  let activeBranch = branch || 'main';
  db.addLog('COGNICÃO', `Iniciando importação completa do repositório: "${owner}/${repo}" [Branch: ${activeBranch}]`);

  // Step 1: List all files recursively using the Git Trees API
  let treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${activeBranch}?recursive=1`;
  let treeRes = await fetch(treeUrl, { headers });

  if (treeRes.status === 404) {
    db.addLog('COGNICÃO', `Branch "${activeBranch}" não localizado. Tentando ramo padrão...`);
    const repoDetailsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (repoDetailsRes.ok) {
      const repoData = await repoDetailsRes.json() as { default_branch?: string; language?: string; description?: string };
      if (repoData.default_branch && repoData.default_branch !== activeBranch) {
        activeBranch = repoData.default_branch;
        treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${activeBranch}?recursive=1`;
        treeRes = await fetch(treeUrl, { headers });
      }
    } else if (activeBranch === 'main') {
      activeBranch = 'master';
      treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${activeBranch}?recursive=1`;
      treeRes = await fetch(treeUrl, { headers });
    }
  }

  if (!treeRes.ok) {
    const errorText = await treeRes.text();
    if (treeRes.status === 403) {
      if (errorText.toLowerCase().includes('rate limit') || treeRes.headers.get('x-ratelimit-remaining') === '0') {
        throw new Error('Limite de taxa da API do GitHub excedido. Por favor, insira um "GitHub Personal Token" para aumentar os limites.');
      }
      throw new Error(`Acesso Negado (403): Token sem permissão para "${owner}/${repo}".`);
    } else if (treeRes.status === 401) {
      throw new Error('Não Autorizado (401): Token inválido ou revogado.');
    } else if (treeRes.status === 404) {
      throw new Error(`Repositório "${owner}/${repo}" ou branch "${activeBranch}" não encontrado.`);
    } else {
      throw new Error(`Falha ao ler árvore git: HTTP ${treeRes.status}`);
    }
  }

  const treeJson = await treeRes.json() as { tree: { path: string; type: string; url: string; size?: number }[] };
  const allGitItems = treeJson.tree || [];

  // Get repo details for metadata
  let repoLanguage = 'Unknown';
  let repoDescription = '';
  try {
    const repoMetaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (repoMetaRes.ok) {
      const meta = await repoMetaRes.json() as any;
      repoLanguage = meta.language || 'Unknown';
      repoDescription = meta.description || '';
    }
  } catch { /* ignore */ }

  // Filter ALL files (exclude binaries and auto-generated files)
  const skipExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'svg', 'woff', 'woff2', 'ttf', 'eot', 'mp4', 'mp3', 'wav', 'zip', 'tar', 'gz', 'lock', 'min.js', 'min.css']);
  const skipPaths = ['node_modules/', 'dist/', 'build/', '.git/', '__pycache__/', '.next/', 'coverage/', '.cache/'];
  
  const allCodeFiles = allGitItems.filter(item => {
    if (item.type !== 'blob') return false;
    const pathLower = item.path.toLowerCase();
    if (skipPaths.some(sp => pathLower.includes(sp))) return false;
    if (pathLower.endsWith('package-lock.json') || pathLower.endsWith('yarn.lock') || pathLower.endsWith('.min.js')) return false;
    const ext = item.path.split('.').pop()?.toLowerCase() || '';
    if (skipExtensions.has(ext)) return false;
    return true;
  });

  // Code files for brain graph analysis (top 50)
  const codeExtensions = ['py', 'js', 'ts', 'tsx', 'jsx', 'rs', 'go', 'java', 'rb', 'php', 'swift', 'kt', 'cpp', 'c', 'cs'];
  const codeFiles = allCodeFiles.filter(f => {
    const ext = f.path.split('.').pop()?.toLowerCase() || '';
    return codeExtensions.includes(ext);
  }).slice(0, 50);

  // Config/dependency files for full analysis
  const configFiles = allCodeFiles.filter(f => {
    const name = f.path.split('/').pop()?.toLowerCase() || '';
    return ['package.json', 'requirements.txt', 'cargo.toml', 'go.mod', 'readme.md', '.env.example', 'dockerfile', 'docker-compose.yml'].includes(name);
  });

  // All files for storage (limit to 200 for performance)
  const filesToStore = allCodeFiles.slice(0, 200);

  db.addLog('MEMORIZAÇÃO', `Repositório ${repo}: ${allCodeFiles.length} arquivos elegíveis. Armazenando ${filesToStore.length} completos, analisando ${codeFiles.length} de código no cérebro.`);

  const repoNodeId = `repo_${owner.replace(/\W/g, '_').toLowerCase()}_${repo.replace(/\W/g, '_').toLowerCase()}`;

  // Save repository to new repositorios table
  await db.saveRepositorioFull({
    id: repoNodeId,
    nome: repo,
    owner,
    url: `https://github.com/${owner}/${repo}`,
    branch: activeBranch,
    linguagem: repoLanguage,
    total_arquivos: filesToStore.length,
    descricao: repoDescription
  });

  let nodesAddedCount = 0;
  let totalClasses = 0;
  let totalFunctions = 0;
  let totalDeps = 0;

  // Create repository master node in memory graph
  db.saveMemory({
    id: repoNodeId,
    conteudo: `Repositório: ${owner}/${repo}`,
    tipo: 'entidade',
    timestamp: new Date().toISOString(),
    visualWeight: 9,
    lastAccessed: new Date().toISOString(),
    repoName: repo,
    details: `Repositório integrado: ${owner}/${repo} | Linguagem: ${repoLanguage} | ${repoDescription}`
  });
  nodesAddedCount++;

  // Connect to core brain nodes
  db.saveRelationship({ id: `rel_repo_${repoNodeId}_cerebro`, origem_id: '4', destino_id: repoNodeId, peso: 9, tipo_relacao: 'Mapeia' });
  db.saveRelationship({ id: `rel_repo_${repoNodeId}_ia`, origem_id: '5', destino_id: repoNodeId, peso: 8, tipo_relacao: 'Codifica' });

  // Process and store ALL files with full content
  for (const gitFile of filesToStore) {
    try {
      const rawUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${gitFile.path}?ref=${activeBranch}`;
      const blobRes = await fetch(rawUrl, { headers: { ...headers, 'Accept': 'application/vnd.github.v3.raw' } });

      if (!blobRes.ok) {
        console.warn(`Skipped file: ${gitFile.path} (HTTP ${blobRes.status})`);
        continue;
      }

      const fileContent = await blobRes.text();
      const language = getLanguageFromPath(gitFile.path);
      const fileId = `file_${repoNodeId}_${gitFile.path.replace(/\W/g, '_').toLowerCase()}`;

      // Save full file content to arquivos table
      await db.saveArquivo({
        id: fileId,
        repositorio_id: repoNodeId,
        caminho: gitFile.path,
        conteudo: fileContent,
        tamanho: fileContent.length,
        linguagem: language
      });

      // Extract and store dependencies from package.json / requirements.txt
      const fileName = gitFile.path.split('/').pop()?.toLowerCase() || '';
      if (['package.json', 'requirements.txt', 'cargo.toml', 'go.mod'].includes(fileName)) {
        const deps = extractDependencies(gitFile.path, fileContent);
        for (const dep of deps.slice(0, 50)) {
          totalDeps++;
          await db.saveDependencia({
            id: `dep_${repoNodeId}_${dep.nome.replace(/\W/g, '_')}`,
            repositorio_id: repoNodeId,
            nome: dep.nome,
            tipo: dep.tipo
          });

          // Add dep to brain graph
          const depNodeId = `dep_${dep.nome.replace(/\W/g, '_').toLowerCase()}`;
          db.saveMemory({
            id: depNodeId,
            conteudo: `Dependência: ${dep.nome}`,
            tipo: 'entidade',
            timestamp: new Date().toISOString(),
            visualWeight: 4,
            lastAccessed: new Date().toISOString(),
            repoName: repo,
            details: `Pacote ${dep.tipo}: ${dep.nome} usado em ${owner}/${repo}`
          });
          db.saveRelationship({ id: `rel_${repoNodeId}_${depNodeId}`, origem_id: repoNodeId, destino_id: depNodeId, peso: 5, tipo_relacao: 'usa_dependencia' });
        }
      }
    } catch (fileErr: any) {
      console.error(`Falha ao processar arquivo ${gitFile.path}:`, fileErr.message);
    }
  }

  // Analyze code files for brain graph (classes, functions)
  for (const gitFile of codeFiles) {
    try {
      const rawUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${gitFile.path}?ref=${activeBranch}`;
      const blobRes = await fetch(rawUrl, { headers: { ...headers, 'Accept': 'application/vnd.github.v3.raw' } });
      if (!blobRes.ok) continue;

      const fileContentString = await blobRes.text();
      const parsed = parseFileCode(gitFile.path, fileContentString);
      const fileNodeId = `file_${repoNodeId}_${gitFile.path.replace(/\W/g, '_').toLowerCase()}`;

      // Create file node in graph
      db.saveMemory({
        id: fileNodeId,
        conteudo: `Arquivo: ${gitFile.path}`,
        tipo: 'fato',
        timestamp: new Date().toISOString(),
        visualWeight: 7,
        lastAccessed: new Date().toISOString(),
        repoName: repo,
        details: `Caminho: ${gitFile.path} | Imports: ${parsed.imports.join(', ') || 'Nenhum'}`
      });
      nodesAddedCount++;

      db.saveRelationship({ id: `rel_${fileNodeId}_${repoNodeId}`, origem_id: fileNodeId, destino_id: repoNodeId, peso: 7, tipo_relacao: 'pertence_ao_repositorio' });

      // Process classes
      parsed.classes.forEach(cls => {
        totalClasses++;
        const classNodeId = `class_${repoNodeId}_${cls.name.replace(/\W/g, '_').toLowerCase()}`;
        db.saveMemory({
          id: classNodeId,
          conteudo: `Classe: ${cls.name}`,
          tipo: 'entidade',
          timestamp: new Date().toISOString(),
          visualWeight: 8,
          lastAccessed: new Date().toISOString(),
          codeSnippet: cls.codeSnippet,
          docstring: cls.docstring,
          repoName: repo,
          details: `Classe em ${gitFile.path}. Métodos: ${cls.methods.join(', ') || 'Nenhum'}`
        });
        nodesAddedCount++;
        db.saveRelationship({ id: `rel_${classNodeId}_${fileNodeId}`, origem_id: classNodeId, destino_id: fileNodeId, peso: 8, tipo_relacao: 'contida_no_arquivo' });
      });

      // Process functions
      parsed.functions.forEach(f => {
        totalFunctions++;
        const funcNodeId = `func_${repoNodeId}_${f.name.replace(/\W/g, '_').toLowerCase()}`;
        db.saveMemory({
          id: funcNodeId,
          conteudo: `Função: ${f.name}`,
          tipo: 'evento',
          timestamp: new Date().toISOString(),
          visualWeight: 6,
          lastAccessed: new Date().toISOString(),
          codeSnippet: f.codeSnippet,
          docstring: f.docstring,
          repoName: repo,
          details: `Função em ${gitFile.path}. Params: (${f.params})` + (f.belongsToClass ? ` | Classe: ${f.belongsToClass}` : '')
        });
        nodesAddedCount++;

        if (f.belongsToClass) {
          const classNodeId = `class_${repoNodeId}_${f.belongsToClass.replace(/\W/g, '_').toLowerCase()}`;
          db.saveRelationship({ id: `rel_${funcNodeId}_${classNodeId}`, origem_id: funcNodeId, destino_id: classNodeId, peso: 9, tipo_relacao: 'metodo_da_classe' });
        } else {
          db.saveRelationship({ id: `rel_${funcNodeId}_${fileNodeId}`, origem_id: funcNodeId, destino_id: fileNodeId, peso: 7, tipo_relacao: 'declarada_no_arquivo' });
        }
      });

    } catch (fileErr: any) {
      console.error(`Falha ao analisar código ${gitFile.path}:`, fileErr.message);
    }
  }

  db.addLog('COGNICÃO', `Importação completa: ${filesToStore.length} arquivos armazenados, ${nodesAddedCount} nós no cérebro, ${totalDeps} dependências detectadas para "${owner}/${repo}".`);

  return {
    filesCount: filesToStore.length,
    classesCount: totalClasses,
    functionsCount: totalFunctions,
    nodesAdded: nodesAddedCount
  };
}
