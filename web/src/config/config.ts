import configJson from './config.json';

export interface RecipatorConfig {
  env: string;
  aws: { region: string };
  cognito: {
    authority: string;
    userPoolId: string;
    userPoolClientId: string;
    cognitoDomain: string;
    redirectUri: string;
    logoutUri: string;
  };
  api: { apiUrl: string };
}

/**
 * Runtime configuration, baked in at build time.
 *
 * `config.json` holds placeholder tokens in source control; `scripts/set-config.sh`
 * overwrites it from SSM for a given environment before a real build/deploy.
 */
const Config = configJson as RecipatorConfig;

export default Config;
