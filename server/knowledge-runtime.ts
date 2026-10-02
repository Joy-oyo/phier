import { OpenAIKnowledgeProvider, type KnowledgeProvider } from './knowledge-provider';
import { LocalKnowledgeProvider } from './local-knowledge';
import { readLocalEnvironment } from './providers/runtime';

export class KnowledgeRuntime implements KnowledgeProvider {
  private provider() {
    const env = readLocalEnvironment();
    return env.PHIER_KNOWLEDGE_PROVIDER === 'local' ||
      (!env.PHIER_KNOWLEDGE_PROVIDER && env.PHIER_PROVIDER === 'local')
      ? new LocalKnowledgeProvider()
      : new OpenAIKnowledgeProvider();
  }
  status() {
    return this.provider().status();
  }
  detect: KnowledgeProvider['detect'] = (...args) => this.provider().detect(...args);
  research: KnowledgeProvider['research'] = (...args) => this.provider().research(...args);
}
