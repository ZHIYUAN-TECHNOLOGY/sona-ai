import { iosConfig } from './ios';

// Sona Pro on iOS, the judge build: the hospital record is the only mode.
export default iosConfig({ name: 'ios-pro', device: 'Sona e2e Pro', appDir: 'native', port: 8093, env: { EXPO_PUBLIC_JUDGE_BUILD: 'true' } });
