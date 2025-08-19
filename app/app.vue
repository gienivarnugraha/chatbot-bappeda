<template>
  <UApp>
    <div class="grid place-items-center h-screen ">
      <UCard class="w-2xl h-3xl ">
        <template #header>
          <div class="flex justify-between items-center">
            <h1>Home {{ threadid }} </h1>

          </div>

        </template>

        <div class="flex-col h-96 overflow-y-auto  gap-8" ref="contentDiv">
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

        <template #footer>
          <p class="text-xs text-amber-200">Pertanyaan yang sering ditanyakan:</p>
          <div class="flex gap-4 my-4">
            <UButton @click="submitExampleMessage(message)" variant="outline" size="sm" color="secondary"
              v-for="message in exampleMessage"> {{ message }} </UButton>

          </div>
          <div class="flex  ">
            <UInput v-model="question" variant="subtle" size="lg" class="w-full pr-4" placeholder="Ask assistant"
              :loading="loading" :disabled="loading" @keydown.enter.exact.prevent="handleSubmit" />
            <UButton @click.prevent="handleSubmit" icon="i-lucide-send" :loading="loading">Submit
            </UButton>
            <!-- <UButton v-else @click.prevent="handleCancel" color="error" icon="i-lucide-x">Cancel</UButton> -->

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
let loading: Ref<Boolean> = ref(false)
let threadid = uuid()

const contentDiv = useTemplateRef('content')

type Message = {
  role: 'user' | 'assistant',
  type?: 'loading' | 'message',
  message: string
}

const messages: Ref<Message[]> = ref([
  {
    role: 'assistant',
    message: 'Hello, apa yang bisa saya bantu?'
  },

])

const exampleMessage: string[] = [
  'Berikan kesimpulan utama yang dapat ditarik dari kajian pengelolaan sampah',
  'Tampilkan dalam tabel bank sampah yang ada di kecamatan ngaliyan',
]

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

  messages.value.push({ role: 'user', message: question.value })

  loading.value = true

  messages.value.push({ role: 'assistant', message: '' })


  try {

    const response = await $fetch<ReadableStream>('/api/chat', {
      method: 'post',
      body: {
        question: question.value,
        uuid: threadid
      },
      responseType: 'stream',
    })

    const reader = response.pipeThrough(new TextDecoderStream()).getReader()

    const lastMessageIndex = messages.value.length - 1

    let markdownMessage = ''

    while (true) {
      const { value, done } = await reader.read();

      console.log(value)


      if (done) {
        console.warn('====Streaming done====')

        //@ts-ignore
        messages.value[lastMessageIndex].message = await markdownToHtml(markdownMessage)
        //@ts-ignore
        messages.value[lastMessageIndex].type = 'message'

        break
      }

      markdownMessage += value
      //@ts-ignore
      messages.value[lastMessageIndex].message = markdownMessage


    }

  } catch (error) {
    console.error('streaming error', error)

    toast.add({
      title: 'Error',
      description: 'Something went wrong',
      color: 'error',
    })

  } finally {
    loading.value = false
    question.value = ''

  }
}
</script>