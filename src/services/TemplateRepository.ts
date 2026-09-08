import * as vscode from 'vscode';

/**
 * Where "New block diagram from template" gets its templates.
 *
 * ONE SOURCE: the public easy-spin-effects repository, fetched over HTTPS the
 * same way easy-spin-web does (see its EffectsRepository). Publishing a template
 * is committing a `.spndiagram` and regenerating `effects/index.json` -- no
 * extension release needed.
 *
 * There are deliberately no bundled fallbacks, so the picker shows exactly what
 * the repository publishes and nothing else. Offline, the user still gets the
 * blank diagram.
 *
 * WHY `formats` AND NOT `format`. An effect ported to a block diagram keeps its
 * original `.spn` beside the new `.spndiagram`, sharing a basename. The index's
 * `format` field is the PRIMARY source and resolves first-match-wins in the
 * order spn, hex, spndiagram -- so for a ported effect it always says "spn" and
 * the diagram is invisible. `formats` lists every source present, which is what
 * we filter on. Older indexes predate that field, so fall back to `format`.
 */

/** Source formats an effect can be published in. */
type SourceFormat = 'spn' | 'hex' | 'spndiagram';

interface IndexEntry {
    id: string;
    name: string;
    description?: string;
    category?: string;
    author?: string;
    tags?: string[];
    directoryPath: string;
    file: string;
    format: SourceFormat;
    /** Every format present. Absent on indexes generated before this existed. */
    formats?: SourceFormat[];
}

interface EffectIndex {
    version?: string;
    categories?: string[];
    effects: IndexEntry[];
}

export interface DiagramTemplate {
    id: string;
    name: string;
    description: string;
    category: string;
    author?: string;
    /** Absolute https URL of the `.spndiagram`. */
    location: string;
}

/** Thrown when the remote index could not be reached or parsed. */
export class TemplateFetchError extends Error {
    constructor(message: string, readonly cause?: unknown) {
        super(message);
        this.name = 'TemplateFetchError';
    }
}

const DEFAULT_BASE = 'https://raw.githubusercontent.com/audiofab/easy-spin-effects/main';

/** How long a successful index fetch is reused before going back to the network. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export class TemplateRepository {
    private cache: { at: number; templates: DiagramTemplate[] } | undefined;

    constructor() { }

    /** Base URL of the effects repository, overridable so a team can host its own. */
    private get baseUrl(): string {
        const configured = vscode.workspace
            .getConfiguration('fv1')
            .get<string>('effectsRepositoryUrl');
        const base = (configured && configured.trim()) || DEFAULT_BASE;
        return base.replace(/\/+$/, '');
    }

    /**
     * Every template on offer.
     *
     * Never throws: a missing network is a normal condition for an editor, and
     * the caller still has the blank diagram to offer. `remoteError` reports what
     * went wrong so it can be mentioned without blocking.
     */
    public async list(options: { refresh?: boolean } = {}): Promise<{
        templates: DiagramTemplate[];
        remoteError?: string;
    }> {
        if (!options.refresh && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) {
            return { templates: this.cache.templates };
        }

        let templates: DiagramTemplate[] = [];
        let remoteError: string | undefined;
        try {
            templates = await this.listRemote();
        } catch (err) {
            remoteError = err instanceof Error ? err.message : String(err);
        }

        // Only cache a clean result; a failed fetch should be retried promptly.
        if (!remoteError) {
            this.cache = { at: Date.now(), templates };
        }
        return { templates, remoteError };
    }

    /** Effects in the remote index that publish a `.spndiagram` source. */
    private async listRemote(): Promise<DiagramTemplate[]> {
        const base = this.baseUrl;
        const indexUrl = `${base}/effects/index.json`;

        let index: EffectIndex;
        try {
            const response = await fetch(indexUrl);
            if (!response.ok) {
                throw new TemplateFetchError(`${indexUrl} returned ${response.status}`);
            }
            index = (await response.json()) as EffectIndex;
        } catch (err) {
            if (err instanceof TemplateFetchError) throw err;
            throw new TemplateFetchError(
                `Could not reach the effects repository at ${indexUrl}`, err);
        }

        if (!index || !Array.isArray(index.effects)) {
            throw new TemplateFetchError(`${indexUrl} is not a valid effect index`);
        }

        return index.effects
            .filter(e => (e.formats ?? [e.format]).includes('spndiagram'))
            .map(e => ({
                id: `remote:${e.id ?? `${e.directoryPath}/${e.file}`}`,
                name: e.name || e.file,
                description: e.description ?? '',
                category: e.category || 'Effects',
                author: e.author,
                location: `${base}/${e.directoryPath}/${e.file}.spndiagram`,
            }))
            .sort((a, b) =>
                a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    }

    /** The template's raw `.spndiagram` text. */
    public async fetchSource(template: DiagramTemplate): Promise<string> {
        try {
            const response = await fetch(template.location);
            if (!response.ok) {
                throw new TemplateFetchError(
                    `${template.location} returned ${response.status}`);
            }
            return await response.text();
        } catch (err) {
            if (err instanceof TemplateFetchError) throw err;
            throw new TemplateFetchError(
                `Could not download "${template.name}"`, err);
        }
    }
}
