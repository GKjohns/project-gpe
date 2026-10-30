<script setup lang="ts">
import type { PaperFigure } from '#shared/types'

// One figure: the image rasterized from the typeset paper, its caption, and what the vision model saw in it.
// Used by the figure-ref popover (compact), the node page's Figures section and the reader's figure dialog.
const props = defineProps<{
  figure: PaperFigure
  /** Popover size: smaller image, clamped caption, no node chips. */
  compact?: boolean
  /** Hide the "Show in paper" button (the reader's own dialog). */
  inReader?: boolean
}>()

const route = useRoute()
const router = useRouter()

const title = computed(() => props.figure.number ? `Figure ${props.figure.number}` : 'Figure')
const kindLabel = computed(() => FIGURE_KIND_LABEL[props.figure.kind] ?? props.figure.kind)

function showInPaper() {
  void router.push({ path: route.path, query: { ...route.query, view: 'paper', figure: props.figure.id } })
}
</script>

<template>
  <figure
    class="flex flex-col gap-2.5"
    :data-figure-card="figure.id"
  >
    <!-- Figures are typeset on white; keep them on white in dark mode too. -->
    <div
      v-if="figure.image_url"
      class="overflow-hidden rounded-md border border-default bg-white p-2"
    >
      <img
        :src="figure.image_url"
        :width="figure.width"
        :height="figure.height"
        :alt="figure.description || `${title}: ${figure.caption}`"
        loading="lazy"
        class="mx-auto h-auto w-full object-contain"
        :class="compact ? 'max-h-56' : 'max-h-[28rem]'"
      >
    </div>
    <div
      v-else
      class="flex items-center gap-2 rounded-md border border-dashed border-default px-3 py-4 text-xs text-muted"
    >
      <UIcon
        name="i-lucide-image-off"
        class="size-4 shrink-0"
      />
      No image: the figure could not be rasterized from this paper.
    </div>

    <figcaption class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="text-sm font-semibold text-highlighted">{{ title }}</span>
        <UBadge
          v-if="figure.description"
          color="neutral"
          variant="soft"
          size="sm"
          :label="kindLabel"
        />
        <span
          v-if="figure.page"
          class="text-xs text-muted"
        >p. {{ figure.page }}</span>
        <UButton
          v-if="!inReader && figure.page"
          label="Show in paper"
          icon="i-lucide-book-open"
          color="neutral"
          variant="link"
          size="xs"
          class="ms-auto px-0"
          data-figure-show
          @click="showInPaper"
        />
      </div>
      <NodeMathText
        v-if="figure.caption"
        :text="figure.caption"
        class="text-sm text-toned"
        :class="compact ? 'line-clamp-3' : ''"
      />

      <div
        v-if="figure.description"
        class="flex flex-col gap-1 rounded-md bg-elevated/60 px-3 py-2"
        data-figure-description
      >
        <div class="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-dimmed uppercase">
          <UIcon
            name="i-lucide-scan-eye"
            class="size-3.5"
          />
          What it shows
        </div>
        <NodeMathText
          :text="figure.description"
          class="text-sm"
          :class="compact ? 'line-clamp-5' : ''"
        />
        <NodeMathText
          v-if="figure.data_summary && !compact"
          :text="figure.data_summary"
          class="text-xs text-muted"
        />
        <div class="text-[11px] text-dimmed">
          Read from the image by {{ figure.model?.replace(/^[a-z]+\//, '') ?? 'a vision model' }} · confidence {{ Math.round(figure.confidence * 100) }}%
        </div>
      </div>

      <div
        v-if="!compact && figure.node_ids.length"
        class="flex flex-wrap items-center gap-1.5"
      >
        <span class="text-xs text-muted">Supports</span>
        <NodeChip
          v-for="id in figure.node_ids"
          :id="id"
          :key="id"
        />
      </div>
    </figcaption>
  </figure>
</template>
