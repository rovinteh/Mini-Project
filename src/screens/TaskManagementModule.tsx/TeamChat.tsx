import React, { useState, useRef, useEffect } from "react";
import { View, FlatList, Image, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform } from "react-native";
import { Text, useTheme } from "react-native-rapi-ui";
import { Ionicons } from "@expo/vector-icons";
import { ChatMessage } from "./data";
import { useTeamMessages } from "./TaskHooks";
import { getAuth } from "firebase/auth";

interface Props {
  projectId: string;
  teamId: string;
  teamName?: string;
  onFocus?: () => void;
  onBlur?: () => void;
}

export default function TeamChat({ projectId, teamId, teamName, onFocus, onBlur }: Props) {
  const { isDarkmode } = useTheme();
  const { messages, loading, sendMessage } = useTeamMessages(projectId, teamId);
  const [inputText, setInputText] = useState("");
  const flatListRef = useRef<FlatList>(null);
  const currentUser = getAuth().currentUser;

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 500);
    }
  }, [messages]);

  const handleSend = () => {
    if (inputText.trim() && currentUser) {
      sendMessage(inputText, currentUser);
      setInputText("");
    }
  };

  const renderMessage = ({ item, index }: { item: ChatMessage; index: number }) => {
    const isMe = item.senderId === currentUser?.uid;
    const showAvatar = !isMe && (index === 0 || messages[index - 1].senderId !== item.senderId);

    return (
      <View style={{ marginBottom: 15, flexDirection: isMe ? 'row-reverse' : 'row', alignItems: 'flex-end', paddingHorizontal: 10 }}>
        {/* Avatar (Left only) */}
        {!isMe && (
           <View style={{ width: 32, marginRight: 8 }}>
                {showAvatar ? (
                    item.senderPhoto ? (
                        <Image source={{ uri: item.senderPhoto }} style={{ width: 32, height: 32, borderRadius: 16 }} />
                    ) : (
                        <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="person" size={16} color="#64748b" />
                        </View>
                    )
                ) : null}
           </View>
        )}

        {/* Message Bubble */}
        <View style={{ maxWidth: '75%' }}>
          {!isMe && showAvatar && (
              <Text style={{ fontSize: 10, opacity: 0.7, marginBottom: 2, marginLeft: 2 }}>
                  {item.senderName}
              </Text>
          )}
          <View 
            style={{ 
                padding: 12, 
                borderRadius: 16, 
                borderBottomRightRadius: isMe ? 4 : 16,
                borderBottomLeftRadius: !isMe ? 4 : 16,
                backgroundColor: isMe ? '#3b82f6' : (isDarkmode ? '#334155' : '#f1f5f9')
            }}
          >
            <Text style={{ color: isMe ? '#fff' : (isDarkmode ? '#fff' : '#0f172a') }}>
                {item.text}
            </Text>
          </View>
          <Text style={{ fontSize: 10, opacity: 0.5, marginTop: 2, alignSelf: isMe ? 'flex-end' : 'flex-start' }}>
              {(() => {
                  const d = new Date(item.createdAt);
                  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
                  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                  return `${date}, ${time}`;
              })()}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: isDarkmode ? '#1e293b' : '#fff', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header */}
      <View style={{ padding: 15, borderBottomWidth: 1, borderBottomColor: isDarkmode ? '#334155' : '#e2e8f0' }}>
         <Text style={{ fontWeight: 'bold' }}>{teamName ? `${teamName} Chat` : "Team Chat"}</Text>
      </View>

      {/* Message List */}
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={item => item.id}
        contentContainerStyle={{ paddingVertical: 20 }}
        showsVerticalScrollIndicator={false}
      />

      {/* Input Area */}
      <View style={{ flexDirection: 'row', padding: 10, alignItems: 'center', borderTopWidth: 1, borderBottomWidth: 40,borderTopColor: isDarkmode ? '#334155' : '#e2e8f0' }}>
          <TextInput
              style={{ 
                  flex: 1, 
                  backgroundColor: isDarkmode ? '#0f172a' : '#f8fafc', 
                  borderRadius: 20, 
                  paddingHorizontal: 15, 
                  paddingVertical: 10,
                  color: isDarkmode ? '#fff' : '#000',
                  marginRight: 10
              }}
              placeholder="Type a message..."
              placeholderTextColor={isDarkmode ? '#64748b' : '#94a3b8'}
              value={inputText}
              onChangeText={setInputText}
              onSubmitEditing={handleSend}
              onFocus={onFocus}
              onBlur={onBlur}
          />
          <TouchableOpacity onPress={handleSend} style={{ padding: 10 }}>
              <Ionicons name="send" size={24} color="#3b82f6" />
          </TouchableOpacity>
      </View>
    </View>
  );
}
