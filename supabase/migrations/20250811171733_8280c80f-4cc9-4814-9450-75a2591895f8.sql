-- Create chats and messages tables with RLS and safe idempotent policy/trigger creation

-- Create chats table
CREATE TABLE IF NOT EXISTS public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

-- Recreate policies for chats
DROP POLICY IF EXISTS "Users can view their own chats" ON public.chats;
CREATE POLICY "Users can view their own chats"
ON public.chats FOR SELECT
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create their own chats" ON public.chats;
CREATE POLICY "Users can create their own chats"
ON public.chats FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own chats" ON public.chats;
CREATE POLICY "Users can update their own chats"
ON public.chats FOR UPDATE
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own chats" ON public.chats;
CREATE POLICY "Users can delete their own chats"
ON public.chats FOR DELETE
USING (auth.uid() = user_id);

-- Trigger to update updated_at
DROP TRIGGER IF EXISTS update_chats_updated_at ON public.chats;
CREATE TRIGGER update_chats_updated_at
BEFORE UPDATE ON public.chats
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Create messages table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_messages_chat
    FOREIGN KEY (chat_id) REFERENCES public.chats(id)
    ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON public.messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_created_at ON public.messages(chat_id, created_at);

-- Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Recreate policies for messages (tie access to ownership of parent chat)
DROP POLICY IF EXISTS "Users can view messages from their chats" ON public.messages;
CREATE POLICY "Users can view messages from their chats"
ON public.messages FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = messages.chat_id AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can insert messages into their chats" ON public.messages;
CREATE POLICY "Users can insert messages into their chats"
ON public.messages FOR INSERT
WITH CHECK (
  auth.uid() = user_id AND
  EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = chat_id AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can update their messages" ON public.messages;
CREATE POLICY "Users can update their messages"
ON public.messages FOR UPDATE
USING (
  auth.uid() = user_id AND
  EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = messages.chat_id AND c.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Users can delete their messages" ON public.messages;
CREATE POLICY "Users can delete their messages"
ON public.messages FOR DELETE
USING (
  auth.uid() = user_id AND
  EXISTS (
    SELECT 1 FROM public.chats c
    WHERE c.id = messages.chat_id AND c.user_id = auth.uid()
  )
);
