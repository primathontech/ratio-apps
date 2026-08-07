import { createFileRoute } from '@tanstack/react-router';
import { ConfigPage } from './-config-page';

export const Route = createFileRoute('/config')({ component: ConfigPage });
