import React from 'react';
import { ChatMessage, NewsSource } from '../types';

interface NewsCardProps {
  message: ChatMessage;
}

const NewsCard: React.FC<NewsCardProps> = ({ message }) => {
  const isUser = message.role === 'user';

  return (
    <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`max-w-[85%] rounded-2xl p-5 ${
          isUser 
            ? 'bg-indigo-600 text-white rounded-br-none' 
            : 'bg-slate-800 border border-slate-700 text-slate-100 rounded-bl-none shadow-xl'
        }`}
      >
        <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap font-light">
          {message.text}
        </p>

        {!isUser && message.sources && message.sources.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-700">
            <p className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">Sources</p>
            <div className="flex flex-wrap gap-2">
              {message.sources.map((source, idx) => (
                <a
                  key={idx}
                  href={source.uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-2 py-1 bg-slate-900 hover:bg-slate-950 text-slate-300 text-xs rounded transition-colors truncate max-w-full"
                  title={source.title}
                >
                  <span className="truncate max-w-[150px]">{source.title}</span>
                  <svg className="w-3 h-3 ml-1 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NewsCard;