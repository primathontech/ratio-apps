import {
  FORM_SELECT_OTHER_DEFAULT_LABEL,
  FORM_SELECT_OTHER_MAX_LENGTH,
  FORM_SELECT_OTHER_SENTINEL,
} from '@ratio-app/shared/schemas/fields/_shared/select-constants';
import { html, nothing, type TemplateResult } from 'lit';
import { type ControlFieldOf, type FieldRenderCtx, selectUiState } from '../types';

export function renderDropdown(
  field: ControlFieldOf<'dropdown'>,
  ctx: FieldRenderCtx,
): TemplateResult {
  const current =
    typeof ctx.values[field.key] === 'string' ? (ctx.values[field.key] as string) : '';
  const inOptions = field.options.some((o) => o.value === current);
  const allowOther = field.allowOther === true;
  const otherLabel = field.otherLabel ?? FORM_SELECT_OTHER_DEFAULT_LABEL;
  const ui = selectUiState(ctx, field.key);
  // "Other" is active when the flag is set OR the stored value is a non-empty
  // non-member (so a persisted free-text value re-opens in Other mode).
  const otherActive = allowOther && (ui.otherActive === true || (current !== '' && !inOptions));
  const promptText = field.prompt ?? field.placeholder ?? 'Select...';

  // The free-text input shown when "Other" is picked — its value IS the field's
  // submitted value (a bounded, non-option string the server accepts).
  const otherInput = otherActive
    ? html`<input
        class="rf-other-input"
        type="text"
        aria-label=${`${field.label} — ${otherLabel}`}
        maxlength=${FORM_SELECT_OTHER_MAX_LENGTH}
        placeholder=${otherLabel}
        .value=${current}
        @input=${(e: Event) => ctx.setValue(field.key, (e.target as HTMLInputElement).value)}
      />`
    : nothing;

  const locals: DropdownLocals = {
    current,
    otherActive,
    allowOther,
    otherLabel,
    promptText,
    otherInput,
  };
  return field.searchable === true
    ? renderCombobox(field, ctx, locals)
    : renderNative(field, ctx, locals);
}

interface DropdownLocals {
  current: string;
  otherActive: boolean;
  allowOther: boolean;
  otherLabel: string;
  promptText: string;
  otherInput: TemplateResult | typeof nothing;
}

/** Today's native <select> (searchable === false), plus the Other affordance. */
function renderNative(
  field: ControlFieldOf<'dropdown'>,
  ctx: FieldRenderCtx,
  l: DropdownLocals,
): TemplateResult {
  const ui = selectUiState(ctx, field.key);
  const onChange = (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    if (v === FORM_SELECT_OTHER_SENTINEL) {
      ui.otherActive = true;
      // Keep prior free text; otherwise clear (empty ⇒ not submitted).
      ctx.setValue(field.key, l.otherActive ? l.current : '');
    } else {
      ui.otherActive = false;
      ctx.setValue(field.key, v);
    }
  };
  const select = html`<select
    id=${ctx.id}
    name=${field.key}
    aria-invalid=${ctx.invalid}
    aria-describedby=${ctx.describedBy}
    @change=${onChange}
  >
    <option value="" ?selected=${!l.otherActive && l.current === ''}>${l.promptText}</option>
    ${field.options.map(
      (opt) =>
        html`<option value=${opt.value} ?selected=${!l.otherActive && l.current === opt.value}>
          ${opt.label}
        </option>`,
    )}
    ${
      l.allowOther
        ? html`<option value=${FORM_SELECT_OTHER_SENTINEL} ?selected=${l.otherActive}>
            ${l.otherLabel}
          </option>`
        : nothing
    }
  </select>`;
  // Bare <select> keeps today's exact output. With Other, wrap the select and
  // its free-text input in a container — a nested template placed as a
  // top-level sibling directly after </select> does not render reliably.
  if (!l.allowOther) return select;
  return html`<div class="rf-select-native">${select}${l.otherInput}</div>`;
}

/** Accessible filterable combobox (searchable === true). */
function renderCombobox(
  field: ControlFieldOf<'dropdown'>,
  ctx: FieldRenderCtx,
  l: DropdownLocals,
): TemplateResult {
  const ui = selectUiState(ctx, field.key);
  const listboxId = `${ctx.id}-listbox`;
  const query = ui.query ?? '';
  const isOpen = ui.open === true;
  const q = query.trim().toLowerCase();
  const filtered =
    q === ''
      ? field.options
      : field.options.filter(
          (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
        );
  const showOther = l.allowOther;
  const otherItemIndex = showOther ? filtered.length : -1;
  const itemCount = filtered.length + (showOther ? 1 : 0);
  const activeIndex = Math.min(Math.max(ui.activeIndex ?? 0, 0), Math.max(itemCount - 1, 0));

  const selectedOpt = field.options.find((o) => o.value === l.current);
  // Open ⇒ the query the shopper is typing; closed ⇒ the current selection.
  const displayText = isOpen ? query : l.otherActive ? l.current : (selectedOpt?.label ?? '');
  const optionId = (i: number) => `${ctx.id}-opt-${i}`;

  const commit = (index: number) => {
    if (showOther && index === otherItemIndex) {
      ui.otherActive = true;
      ui.open = false;
      ui.query = '';
      ctx.setValue(field.key, l.otherActive ? l.current : '');
      ctx.requestUpdate();
      return;
    }
    const opt = filtered[index];
    if (!opt) return;
    ui.otherActive = false;
    ui.open = false;
    ui.query = '';
    ctx.setValue(field.key, opt.value);
    ctx.requestUpdate();
  };

  const onKeydown = (e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) ui.open = true;
        else ui.activeIndex = itemCount === 0 ? 0 : (activeIndex + 1) % itemCount;
        ctx.requestUpdate();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!isOpen) ui.open = true;
        else ui.activeIndex = itemCount === 0 ? 0 : (activeIndex - 1 + itemCount) % itemCount;
        ctx.requestUpdate();
        break;
      case 'Enter':
        if (isOpen) {
          e.preventDefault();
          commit(activeIndex);
        }
        break;
      case 'Escape':
        if (isOpen) {
          e.preventDefault();
          ui.open = false;
          ui.query = '';
          ctx.requestUpdate();
        }
        break;
      default:
        break;
    }
  };

  return html`<div class="rf-combo" data-open=${isOpen ? 'true' : nothing}>
      <input
        id=${ctx.id}
        class="rf-combo-input"
        type="text"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        aria-expanded=${isOpen ? 'true' : 'false'}
        aria-controls=${listboxId}
        aria-invalid=${ctx.invalid}
        aria-describedby=${ctx.describedBy}
        aria-activedescendant=${isOpen && itemCount > 0 ? optionId(activeIndex) : nothing}
        placeholder=${l.promptText}
        .value=${displayText}
        @input=${(e: Event) => {
          ui.query = (e.target as HTMLInputElement).value;
          ui.open = true;
          ui.activeIndex = 0;
          ctx.requestUpdate();
        }}
        @keydown=${onKeydown}
        @focus=${() => {
          ui.open = true;
          ctx.requestUpdate();
        }}
        @blur=${() => {
          ui.open = false;
          ui.query = '';
          ctx.requestUpdate();
        }}
      />
      <ul class="rf-combo-list" id=${listboxId} role="listbox" ?hidden=${!isOpen}>
        ${filtered.map(
          (opt, i) =>
            html`<li
              id=${optionId(i)}
              role="option"
              class="rf-combo-opt"
              aria-selected=${!l.otherActive && l.current === opt.value ? 'true' : 'false'}
              data-active=${i === activeIndex || nothing}
              @mousedown=${(e: Event) => {
                e.preventDefault();
                commit(i);
              }}
            >
              ${opt.label}
            </li>`,
        )}
        ${
          showOther
            ? html`<li
                id=${optionId(otherItemIndex)}
                role="option"
                class="rf-combo-opt rf-combo-other"
                aria-selected=${l.otherActive ? 'true' : 'false'}
                data-active=${otherItemIndex === activeIndex || nothing}
                @mousedown=${(e: Event) => {
                  e.preventDefault();
                  commit(otherItemIndex);
                }}
              >
                ${l.otherLabel}
              </li>`
            : nothing
        }
        ${
          filtered.length === 0 && !showOther
            ? html`<li class="rf-combo-empty" role="presentation">No matches</li>`
            : nothing
        }
      </ul>
      ${l.otherInput}
    </div>`;
}
