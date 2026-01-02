@echo off
chcp 65001 >nul
echo ========================================
echo 博客一键部署脚本
echo ========================================
echo.

echo [1/3] 添加文件到 Git...
git add .

echo [2/3] 提交更改...
set /p commit_msg=请输入提交信息（直接回车使用默认）:
if "%commit_msg%"=="" (
    git commit -m "更新博客 %date% %time%"
) else (
    git commit -m "%commit_msg%"
)

echo [3/3] 推送到 GitHub（触发自动部署）...
git push

echo.
echo ========================================
echo ✅ 部署完成！
echo.
echo 稍等 1-2 分钟后访问：
echo   Cloudflare Pages: https://lingshichat.pages.dev
echo   GitHub Pages: https://lingshichat.github.io
echo ========================================
echo.
pause
