import { Users, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Room } from '../../entities/room/types';
import GroupChatItem from './GroupChatItem';

interface GroupChatListProps {
    rooms: Room[];
    setRoomId: (id: string | null) => void;
    selectedRoomId: string | null;
    openCreateGroupChatModal: () => void;
    openEditGroupChatModal: () => void;
}

function GroupChatList({ rooms, setRoomId, selectedRoomId, openCreateGroupChatModal, openEditGroupChatModal }: GroupChatListProps) {
    const { t } = useTranslation();
    const isMobile = window.innerWidth <= 768;
    if (rooms.length === 0) return null;

    return (
        <div className="border-b border-(--color-border-secondary)">
            <div className="group flex items-center justify-between px-4 py-2 bg-(--color-bg-secondary)">
                <div className="flex items-center space-x-2">
                    <Users className="w-4 h-4 text-(--color-icon-tertiary)" />
                    <h3 className="text-sm font-semibold text-(--color-text-interface)">{t('sidebar.groups.header')}</h3>
                    <span className="text-xs bg-(--color-bg-secondary-accent) text-(--color-text-tertiary) px-2 py-0.5 rounded-full">
                        {rooms.length}
                    </span>
                </div>
                <button
                    onClick={openCreateGroupChatModal}
                    className="opacity-0 group-hover:opacity-100 transition-all p-1 bg-(--color-button-primary)/80 hover:bg-(--color-button-primary)/90 rounded-full text-(--color-text-accent)"
                    title={t('sidebar.groups.newGroupTitle')}
                >
                    <Plus className="w-3 h-3" />
                </button>
            </div>
            <div>
                {rooms.map(room => (
                    <GroupChatItem
                        key={room.id}
                        room={room}
                        setRoomId={setRoomId}
                        isSelected={selectedRoomId === room.id}
                        openEditGroupChatModal={openEditGroupChatModal}
                        useDoubleClick={isMobile}
                    />
                ))}
            </div>
        </div>
    );
}

export default GroupChatList;