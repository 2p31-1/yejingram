import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState } from '../../app/store';
import { syncActions } from '../../entities/sync/slice';
import { restoreStateFromServer } from '../../utils/backup';

const SyncConflictModal: React.FC = () => {
    const dispatch = useDispatch();
    const { status, conflict } = useSelector((state: RootState) => state.sync);
    const { syncSettings } = useSelector((state: RootState) => state.settings);

    if (status !== 'conflict' || !conflict) return null;

    const handleUseServer = async () => {
        try {
            restoreStateFromServer(
                syncSettings.syncClientId,
                syncSettings.syncBaseUrl
            )
        } catch (e) {
            console.error("서버 복구 실패", e);
            alert("서버 데이터를 불러오지 못했습니다.");
        }
    };

    const handleOverwriteServer = async () => {
        try {
            const { buildBackupPayload } = await import('../../utils/backup');
            const payload = buildBackupPayload();

            const response = await fetch(
                `${syncSettings.syncBaseUrl}/api/sync/${syncSettings.syncClientId}?force=true`,
                {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload.data),
                }
            );

            if (response.ok) {
                const resData = await response.json();
                dispatch(syncActions.updateFromSnapshot({ seq: resData.seq || 0 }));
                dispatch(syncActions.clearPatchQueue());
                dispatch(syncActions.resolveConflict());
            } else {
                alert("서버 덮어쓰기에 실패했습니다.");
            }
        } catch (e) {
            console.error("서버 덮어쓰기 오류", e);
            alert("서버 덮어쓰기 중 문제가 발생했습니다.");
        }
    };

    if (!conflict.localPatch) return null;
    return (
        <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-fadeIn">
            <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-[0_8px_32px_rgba(0,0,0,0.2)] dark:bg-gray-800 animate-slideUp">

                {/* Header Icon */}
                <div className="flex flex-col items-center mb-6">
                    <h2 className="mt-4 text-2xl font-bold text-gray-900 dark:text-white">
                        동기화 충돌 발생
                    </h2>
                    <p className="mt-2 text-center text-gray-600 dark:text-gray-300">
                        서버 데이터와 내 로컬 데이터가 서로 다른 변경 내용을 가지고 있습니다.
                    </p>
                </div>

                {/* Info Box */}
                <div className="rounded-xl bg-gray-100 px-4 py-3 text-sm text-gray-700 dark:bg-gray-700 dark:text-gray-200 mb-6">
                    <p className="leading-relaxed">
                        <b>서버 상태:</b> Seq {conflict.serverSnapshot?.seq ?? '??'} + {conflict.serverPatches.length} 패치<br />
                        <b>내 기준 상태:</b> Base Seq {conflict.localPatch.baseSeq}
                    </p>
                </div>

                {/* Buttons */}
                <div className="flex flex-col gap-4">
                    <button
                        onClick={handleUseServer}
                        className="
                            w-full rounded-xl bg-blue-600 px-5 py-3 text-center 
                            font-semibold text-white shadow hover:bg-blue-700 
                            active:scale-[0.98] transition-all
                        "
                    >
                        서버 버전 사용 (내 변경 사항 삭제)
                    </button>

                    <button
                        onClick={handleOverwriteServer}
                        className="
                            w-full rounded-xl border border-red-500 px-5 py-3 
                            text-center font-semibold text-red-600 
                            hover:bg-red-50 dark:hover:bg-red-900/20 
                            active:scale-[0.98] transition-all
                        "
                    >
                        서버 덮어쓰기 (내 변경 사항 강제 적용)
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SyncConflictModal;
