<template>
  <UApp>
    <!-- class="grid md:grid-cols-2 grid-cols-1 bg-[url('/bg.png')] dark:bg-[url('/bg-dark.png')] bg-no-repeat bg-cover bg-center md:bg-none!"  -->
    <div class="relative  h-full ">

      <!-- BACKGROUND -->
      <div
        class="absolute inset-0 bg-[url('/bg.png')] dark:bg-[url('/bg-dark.png')] bg-repeat-x bg-size-[auto_50%] bg-bottom opacity-75">
      </div>
      <!-- <div class="absolute inset-0 bg-[url('/bg_2.png')]  bg-no-repeat bg-top bg-contain opacity-25"></div> -->
      <div class="absolute inset-0 bg-linear-to-b from-gray-100 to-cyan-300 dark:to-cyan-300 opacity-10"></div>
      <!-- BACKGROUND END -->


      <div class="relative">
        <div class=" flex justify-between items-center w-full px-4 py-2 bg-primary">
          <div class="flex gap-2 items-center">
            <img src="/icon.png" alt="logo" class="max-w-8"></img>
            <div class="flex flex-col">
              <p class="text-lg">BAPPEDA</p>
              <p class="text-xs">KOTA SEMARANG</p>

            </div>
          </div>
          <h1> Home </h1>
          <ColorMode class="w-8" />

        </div>
      </div>

      <div class="relative flex flex-col items-center justify-center p-4">

        <div v-show="isFirstMessage" class="flex flex-col gap-2 items-center justify-center my-16 transition">
          <img src="/icon.png" alt="logo" class="max-w-20"></img>
          <h2 class="text-md text-center font-light">Badan Pembangunan Daerah</h2>
          <h1 class="text-4xl text-center font-bold">KOTA SEMARANG</h1>
          <h1 class="text-5xl text-center font-bold">Big Data AI Chatbot</h1>
          <h3 class="text-md text-center font-light">Layanan Cerdas, Informasi Cepat, Semarang di Ujung Jari Anda.</h3>
        </div>

        <!-- Question and Answer -->
        <UCard class="w-full max-w-2xl h-full">
          <!-- <template #header>
            
          </template> -->

          <div v-show="!isFirstMessage" class="flex-col min-h-48 max-h-96 overflow-y-auto transition" ref="content">
            <div v-for="(message, index) in messages" class="my-2">
              <div class="flex justify-end gap-4 items-center" v-if="message.role === 'user'">
                <p class="prose max-w-1/2 bg-secondary p-4 rounded-lg ">
                  {{ message.message }}
                </p>
                <UAvatar icon="i-lucide-user" />
              </div>

              <div v-else class="flex gap-4 overflow-x-auto items-center ">
                <UAvatar icon="i-lucide-image" />

                <!-- LOADING -->
                <div class="grid gap-2" v-if="message.type === 'loading'">
                  <USkeleton class="h-4 w-[250px]" />
                  <USkeleton class="h-4 w-[200px]" />
                </div>

                <div v-else id="markdown"
                  class="bg-primary-300 dark:bg-primary-700 p-4 rounded-lg prose-sm md:prose max-w-prose dark:prose-invert"
                  v-html="message.message"></div>

              </div>

            </div>
          </div>


          <div class="flex">
            <UInput v-model="question" variant="subtle" size="lg" class="w-full pr-4" placeholder="Ask assistant"
              :loading="loading" :disabled="loading" @keydown.enter.exact.prevent="handleSubmit" />
            <UButton v-if="loading" @click.prevent="handleCancel" color="error" icon="i-lucide-x">Cancel
            </UButton>
            <UButton v-else @click.prevent="handleSubmit" :disabled="question.length === 0" icon="i-lucide-send"
              :loading="loading">
              Submit
            </UButton>
          </div>

          <div class="mt-4" v-show="isFirstMessage">
            <p class="text-xs text-primary">Pertanyaan contoh:</p>
            <div class="flex flex-col gap-2 my-2">
              <UButton @click="submitExampleMessage(message)" :disabled="loading" variant="outline" size="sm"
                color="secondary" v-for="message in exampleMessage"> {{ message }} </UButton>
            </div>
          </div>
        </UCard>
        <!-- QnA End -->
      </div>

      <!-- <div class="hidden md:block bg-[url('/bg.png')] dark:bg-[url('/bg-dark.png')] bg-no-repeat bg-cover bg-center">
      </div> -->
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
import { v4 as uuid } from 'uuid'

const toast = useToast()

let question: Ref<string> = ref('')
let loading: Ref<Boolean> = ref(false)
let abortController: AbortController | null
let threadId: string = uuid()
let contentRef: Ref<HTMLDivElement | null> = useTemplateRef('content')

type Message = {
  role: 'user' | 'assistant',
  type?: 'loading' | 'message',
  message: string
}


const toUpperFirst = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)

const messages: Ref<Message[]> = ref([
  // {
  //   role: 'assistant',
  //   message: 'Hello, apa yang bisa saya bantu?'
  // }
])

const isFirstMessage = computed(() => messages.value.length === 0)

const handleCancel = () => {
  if (abortController) {
    abortController.abort()
  }

  abortController = null
}

const exampleMessage: string[] = [
  'Tampilkan dalam tabel bank sampah yang ada di kecamatan ngaliyan',
  'Tampilkan dalam tabel Kebutuhan Air Domestik Kecamatan Tugu',
]


const submitExampleMessage = (message: string) => {
  question.value = message
  handleSubmit()
}

const scrollToBottom = () => {
  contentRef.value?.scrollTo({ left: 0, top: contentRef.value?.scrollHeight, behavior: "smooth" })
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

  messages.value.push({ role: 'assistant', type: 'loading', message: '' })

  scrollToBottom()

  try {
    const response = await $fetch<ReadableStream>('/api/chat', {
      method: 'post',
      body: {
        question: question.value,
        uuid: threadId
      },
      responseType: 'stream',
      signal: abortController.signal
    })

    const reader = response.pipeThrough(new TextDecoderStream()).getReader()

    const lastMessageIndex = messages.value.length - 1

    //@ts-ignore
    messages.value[lastMessageIndex].type = 'message'

    let markdownMessage = ''

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        //@ts-ignore
        messages.value[lastMessageIndex].message = await markdownToHtml(markdownMessage)

        //@ts-ignore
        console.log(messages.value[lastMessageIndex].message)

        break
      }
      markdownMessage += value

      //@ts-ignore
      messages.value[lastMessageIndex].message = markdownMessage

      scrollToBottom()

    }

  } catch (error) {
    let errMessage = ''
    console.log('streaming error', error)

    // if (error.name === "AbortError") {
    //   errMessage = 'Fetch aborted by user action (browser stop button, closing tab, etc.)'
    // }

    toast.add({
      title: 'Error',

      // @ts-ignore
      description: errMessage || error.message || 'Error occured while streaming',
      color: 'error',
    })

  } finally {
    loading.value = false
    question.value = ''

  }
}
</script>