import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/components/ui/use-toast";
import { Helmet } from "react-helmet-async";

interface Msg {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

const Chat = () => {
  const { toast } = useToast();
  const [chatId, setChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Ensure a chat exists for the current user
  useEffect(() => {
    let mounted = true;

    const init = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) return;

      // Try to find an existing chat
      const { data: existing, error: selErr } = await supabase
        .from("chats")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1);
      if (selErr) console.warn(selErr);

      let id = existing?.[0]?.id as string | undefined;
      if (!id) {
        const { data: created, error: insErr } = await supabase
          .from("chats")
          .insert({ user_id: userId, title: "New Chat" })
          .select("id")
          .single();
        if (insErr) {
          console.error(insErr);
          toast({ title: "Failed to create chat", description: insErr.message, variant: "destructive" });
          return;
        }
        id = created!.id;
      }

      if (!mounted) return;
      setChatId(id);

      // Load messages
      const { data: msgs, error: msgErr } = await supabase
        .from("messages")
        .select("id, role, content, created_at")
        .eq("chat_id", id)
        .order("created_at", { ascending: true });
      if (msgErr) console.error(msgErr);
      setMessages((msgs as Msg[]) || []);

      // Realtime subscription for new inserts
      const channel = supabase
        .channel("schema-db-changes")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `chat_id=eq.${id}` },
          (payload: any) => {
            setMessages((prev) => [...prev, payload.new as Msg]);
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    };

    init();
    return () => {
      mounted = false;
    };
  }, [toast]);

  const handleSend = async () => {
    if (!chatId || !input.trim()) return;

    try {
      setLoading(true);
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id!;

      // Insert user message
      const userMessage = { chat_id: chatId, user_id: userId, role: "user" as const, content: input.trim() };
      const { error: insErr } = await supabase.from("messages").insert(userMessage);
      if (insErr) throw insErr;

      setInput("");

      // Build short context including new message
      const lastMessages = [...messages.slice(-10), { id: "temp", role: "user" as const, content: userMessage.content, created_at: new Date().toISOString() }];
      const payload = lastMessages.map((m) => ({ role: m.role, content: m.content }));

      // Call Edge Function
      const { data, error } = await supabase.functions.invoke("generate-chat", {
        body: { messages: payload },
      });
      if (error) throw error;

      const assistantText = (data as any)?.content || "";
      if (assistantText) {
        const { error: aErr } = await supabase.from("messages").insert({
          chat_id: chatId,
          user_id: userId,
          role: "assistant",
          content: assistantText,
        });
        if (aErr) throw aErr;
      }
    } catch (e: any) {
      console.error(e);
      toast({ title: "Error", description: e.message || "Failed to send message", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/auth";
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <Helmet>
        <title>Chatbot – Secure AI Chat</title>
        <meta name="description" content="Secure AI chat with email login and realtime messages." />
        <link rel="canonical" href={typeof window !== 'undefined' ? window.location.href : '/chat'} />
      </Helmet>
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Chat</h1>
          <Button variant="secondary" onClick={logout}>Logout</Button>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-4 py-4 grid gap-4">
        <Card>
          <CardContent className="p-0">
            <div className="h-[65vh] overflow-y-auto p-4 space-y-3">
              {messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
                  <div className={`inline-block rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                    {m.content}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <div className="border-t p-3 flex gap-2">
              <Input
                placeholder="Type your message..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
              />
              <Button onClick={handleSend} disabled={loading || !input.trim()}>Send</Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
};

export default Chat;
