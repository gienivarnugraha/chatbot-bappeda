<template>
  <UApp>

    <div class="flex  items-start justify-center h-screen p-8">
      <UCard class="flex w-30  " title="konteks">
        <p class="text-xs text-amber-200">Konteks pertanyaan:</p>

        <UButton v-for="{ name } in contexts" class="my-2 w-full" :disabled="context === name"
          @click="handleContext(name)"> {{ toUpperFirst(name) }}
        </UButton>
      </UCard>

      <UCard class="w-2xl h-3xl ">
        <template #header>
          <div class="flex justify-between items-center">
            <h1>{{ context && toUpperFirst(findContext(context).name) || 'Home' }}</h1>
            <p class="text-xs text-amber-200">{{ context && findContext(context).id || '' }}</p>
          </div>

        </template>

        <div v-if="context" class="flex-col h-96 overflow-y-auto  gap-8" ref="content">
          <div v-for="(message, index) in messages" :class="[
          'my-4 p-4 rounded-lg ',
          message.role === 'user' ? 'justify-self-end' : 'justify-self-start',
          message.role === 'user' ? 'bg-secondary-800' : 'bg-primary-800'
        ]">
            <div class="flex gap-4 items-center" v-if="message.role === 'user'">
              <UAvatar icon="i-lucide-user" />
              <p>
                {{ message.message }}
              </p>
            </div>
            <div v-else class="flex gap-4 overflow-x-auto items-center ">
              <UAvatar icon="i-lucide-image" />
              <!--  <div class="grid gap-2" v-if="message.type === 'loading'">
                  <USkeleton class="h-4 w-[250px]" />
                  <USkeleton class="h-4 w-[200px]" />
                </div> -->

              <!-- <div v-else id="markdown" v-html="marked.parse(message.message)"></div> -->
              <div id="markdown" class="prose" v-html="message.message"></div>
            </div>

          </div>
        </div>

        <div v-else>
          <p class="text-xs text-amber-200">Pilih Konteks Pembicaraan</p>

        </div>

        <template #footer v-if="context">
          <div>
            <p class="text-xs text-amber-200">Pertanyaan contoh:</p>
            <div class="flex gap-4 my-4">
              <UButton @click="submitExampleMessage(message)" :disabled="loading" variant="outline" size="sm"
                color="secondary" v-for="message in exampleMessage[context]"> {{ message }} </UButton>
            </div>
          </div>

          <div class="flex">
            <UInput v-model="question" variant="subtle" size="lg" class="w-full pr-4" placeholder="Ask assistant"
              :loading="loading" :disabled="loading" @keydown.enter.exact.prevent="handleSubmit" />
            <UButton v-if="loading" @click.prevent="handleCancel" color="error" icon="i-lucide-x">Cancel
            </UButton>
            <UButton v-else @click.prevent="handleSubmit" icon="i-lucide-send" :loading="loading">Submit
            </UButton>

          </div>
        </template>
      </UCard>
    </div>
  </UApp>
</template>


<style>
#markdown {
  table {
    border-collapse: collapse;
  }

  tr {
    border-bottom: solid 1px rgb(92, 92, 92);
  }

  td,
  thead {
    padding: 12px;
  }
}
</style>

<script setup lang="ts">
import { markdownToHtml } from './composables/markdown'
import { v4 as uuid } from 'uuid'

const toast = useToast()

let question: Ref<string> = ref('')
let context: Ref<string> = ref('')
let loading: Ref<Boolean> = ref(false)
let abortController: AbortController | null

let contentRef = useTemplateRef('content')

type Message = {
  role: 'user' | 'assistant',
  type?: 'loading' | 'message',
  message: string
}

const toUpperFirst = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)

const messages: Ref<Message[]> = ref([
  {
    role: 'assistant',
    message: 'Hello, apa yang bisa saya bantu?'
  },

])

type Context = {
  name: string,
  id: string,
  message: Message[]
}

const contexts: Context[] = [
  { name: 'sampah', id: uuid(), message: [] },
  { name: 'rispam', id: uuid(), message: [] }
]

const findContext: Context | any = (value: string) => {
  return contexts.find(c => c.name === value)
}

const handleCancel = () => {
  if (abortController) {
    abortController.abort()
  }

  abortController = null
}

const handleContext = (value: string) => {
  const found = findContext(value)

  if (found) {
    messages.value = found.message
  }

  context.value = value
}

const exampleMessage: Record<string, string[]> = {
  'sampah': [
    'Berikan kesimpulan utama yang dapat ditarik dari kajian pengelolaan sampah',
    'Tampilkan dalam tabel bank sampah yang ada di kecamatan ngaliyan',
  ],
  'rispam': [
    'Berikan kesimpulan utama yang dapat ditarik dari kajian pengelolaan air',
    'Tampilkan dalam tabel Kebutuhan Air Domestik Kecamatan Tugu',
  ]
}

const submitExampleMessage = (message: string) => {
  question.value = message
  handleSubmit()
}


/**
 * Sends a POST request to the /api/chat endpoint
 * with the value of the question input field
 * and updates the messages array with the response.
 */
const handleSubmit = async () => {

  abortController = new AbortController()

  messages.value.push({ role: 'user', message: question.value })

  loading.value = true

  messages.value.push({ role: 'assistant', message: '' })

  const threadId = findContext(context.value).id

  try {

    const response = await $fetch<ReadableStream>('/api/chat', {
      method: 'post',
      body: {
        question: question.value,
        context: context.value,
        uuid: threadId
      },
      responseType: 'stream',
      signal: abortController.signal
    })

    const reader = response.pipeThrough(new TextDecoderStream()).getReader()

    const lastMessageIndex = messages.value.length - 1

    let markdownMessage = ''

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        //@ts-ignore
        messages.value[lastMessageIndex].message = await markdownToHtml(markdownMessage)
        //@ts-ignore
        messages.value[lastMessageIndex].type = 'message'

        break
      }

      markdownMessage += value
      //@ts-ignore
      messages.value[lastMessageIndex].message = markdownMessage

      // @ts-ignore
      contentRef.value.scrollTo({ left: 0, top: contentRef.value.scrollHeight, behavior: "smooth" })

    }

  } catch (error) {
    let errMessage = ''
    console.error('streaming error', error)

    if (error.name === "AbortError") {
      errMessage = 'Fetch aborted by user action (browser stop button, closing tab, etc.)'
    }

    toast.add({
      title: 'Error',
      description: errMessage || error.message || 'Error occured while streaming',
      color: 'error',
    })

  } finally {
    loading.value = false
    question.value = ''

  }
}
</script>